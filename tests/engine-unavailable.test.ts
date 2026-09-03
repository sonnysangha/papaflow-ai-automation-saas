import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the two eve agents do when they cannot reach Convex.
 *
 * This is the production failure reproduced honestly: no `CONVEX_URL` and no `NEXT_PUBLIC_CONVEX_URL`
 * in the process, which is exactly what an eve service on Vercel had before the project variable
 * existed (`lib/engine-env.ts` explains why). Nothing is mocked except the Clerk billing read, so the
 * refusal travels the real path — `engineEnv` → `EngineUnavailableError` → the tool's own guard.
 *
 * Two behaviours are pinned, because both were wrong:
 *
 * - a **Builder** tool answers with a terminal result instead of throwing, so the model stops rather
 *   than calling the same tool nine times;
 * - the **Runtime** agent's dynamic resolver degrades to `http_request` and logs why, instead of
 *   failing silently and looking like an org with no connections.
 */
const { orgPlanFromClerk } = vi.hoisted(() => ({ orgPlanFromClerk: vi.fn() }));
vi.mock("@/lib/billing-engine", () => ({ orgPlanFromClerk }));

const { ConvexError } = await import("convex/values");
const { EngineUnavailableError } = await import("@/lib/engine-env");
const { resolveConnectorTools } = await import("@/agents/runtime/lib/connector-session");
const { asServiceFailure, isToolFailure, serviceUnavailable, toolResult, viaEngine } = await import(
  "@/agents/builder/lib/tool-result"
);

const addNode = (await import("@/agents/builder/tools/add_node")).default;
const listConnections = (await import("@/agents/builder/tools/list_connections")).default;
const listNodeTypes = (await import("@/agents/builder/tools/list_node_types")).default;
const validateWorkflow = (await import("@/agents/builder/tools/validate_workflow")).default;
const requestConnection = (await import("@/agents/builder/tools/request_connection")).default;

/** A session as `agents/builder/channels/eve.ts` projects it from a verified Clerk token. */
const CTX = {
  session: {
    auth: { current: { attributes: { orgId: "org_1", userId: "user_1", workflowId: "wf_1" } } },
  },
};

/** Tools are typed against eve's `ToolContext`; a test only ever supplies the session half. */
type Executable = { execute: (input: never, ctx: never) => Promise<unknown> };

async function run(tool: unknown, input: unknown): Promise<unknown> {
  return await (tool as Executable).execute(input as never, CTX as never);
}

/** What every tool must answer with when PapaFlow's backend is not configured. */
function expectTerminal(result: unknown) {
  expect(result).toMatchObject({ ok: false, error: "service_unavailable", retryable: false });
  expect(String((result as { message: string }).message)).toContain(
    "CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  orgPlanFromClerk.mockResolvedValue("pro");
  // The deployment the bug happened on: an eve service with neither spelling of the Convex URL.
  vi.stubEnv("CONVEX_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", undefined);
  vi.stubEnv("ENGINE_SECRET", "shared-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the Builder's tool guard", () => {
  it("returns a terminal result rather than throwing, so the model stops", async () => {
    const failure = await toolResult(async () => {
      throw new EngineUnavailableError("builder-engine: CONVEX_URL is not set");
    });
    expect(failure).toMatchObject({
      ok: false,
      error: "service_unavailable",
      retryable: false,
      message: "The Builder cannot reach PapaFlow's backend: builder-engine: CONVEX_URL is not set.",
    });
    expect(isToolFailure(failure)).toBe(true);
  });

  it("lets a refusal through — a bad node type is the model's to fix", async () => {
    await expect(
      toolResult(async () => {
        throw new Error("There is no node type \"http.reqest\".");
      }),
    ).rejects.toThrow(/no node type/);
  });

  it("classifies an unexpected failure from an engine call as unreachable, not as a refusal", async () => {
    await expect(
      viaEngine(async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toMatchObject({ name: "EngineUnavailableError", retryable: false });
  });

  it("passes a Convex refusal through untouched — the model is the one who fixes it", async () => {
    // The hinge the whole classification turns on. If a ConvexError ever stopped being recognised,
    // every ordinary refusal would come back as `service_unavailable` and the instructions would
    // have the model end the turn blaming the deployment.
    const refusal = new ConvexError({
      code: "node_not_found",
      message: 'There is no node "n_7".',
    });

    await expect(
      viaEngine(async () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
  });

  it("recognises a Convex refusal by shape too, in case the bundle holds two copies", async () => {
    // eve compiles the Builder into its own bundle; a duplicated `convex/values` would break
    // `instanceof` and nothing else would notice.
    const lookalike = Object.assign(new Error("version conflict"), {
      name: "ConvexError",
      data: { code: "version_conflict", message: "Someone else saved first." },
    });

    await expect(
      viaEngine(async () => {
        throw lookalike;
      }),
    ).rejects.toBe(lookalike);
  });

  it("treats a rejected shared secret as infrastructure, not as something to retry", async () => {
    // `convex/builder.ts` and `convex/engine.ts` both answer a missing or mismatched ENGINE_SECRET
    // with ConvexError({ code: "unauthorized" }) — the default state of a fresh per-branch preview
    // deployment, and indistinguishable from a refusal unless it is named.
    await expect(
      viaEngine(async () => {
        throw new ConvexError({ code: "unauthorized" });
      }),
    ).rejects.toMatchObject({ name: "EngineUnavailableError", retryable: false });

    const failure = asServiceFailure(new ConvexError({ code: "unauthorized" }));
    expect(failure).toMatchObject({ ok: false, error: "service_unavailable", retryable: false });
    expect(failure?.message).toContain("ENGINE_SECRET");
  });

  it("leaves a Convex refusal out of asServiceFailure", () => {
    expect(asServiceFailure(new ConvexError({ code: "not_found" }))).toBeNull();
    expect(asServiceFailure(new Error("There is no node type \"http.reqest\"."))).toBeNull();
  });

  it("never repeats the shared secret into the result the model reads", async () => {
    // Convex echoes the arguments it refused to validate, and one of them is the shared secret.
    // This object is read by the model, shown in the chat panel, and recorded by the Workflow SDK
    // as a step return value (CLAUDE.md rule 1).
    const failure = await toolResult(async () => {
      await viaEngine(async () => {
        throw new Error('ArgumentValidationError: { secret: "shared-secret", orgId: "org_1" }');
      });
    });

    expect(isToolFailure(failure)).toBe(true);
    const message = (failure as { message: string }).message;
    expect(message).not.toContain("shared-secret");
    expect(message).toContain("••••");
  });

  it("describes a thrown non-error without inventing a cause", () => {
    expect(serviceUnavailable(undefined).message).toBe(
      "The Builder cannot reach PapaFlow's backend: the backend could not be reached.",
    );
  });

  it("only recognises its own shape", () => {
    expect(isToolFailure({ ok: false, error: "service_unavailable" })).toBe(true);
    expect(isToolFailure({ ok: true })).toBe(false);
    expect(isToolFailure({ ok: false, error: "not_found" })).toBe(false);
    expect(isToolFailure(null)).toBe(false);
  });
});

describe("a Builder tool against an unconfigured deployment", () => {
  it("list_connections answers terminally instead of being retried nine times", async () => {
    expectTerminal(await run(listConnections, {}));
  });

  it("add_node answers terminally", async () => {
    expectTerminal(await run(addNode, { type: "http.request" }));
  });

  it("validate_workflow answers terminally", async () => {
    expectTerminal(await run(validateWorkflow, {}));
  });

  it("request_connection stops before it parks a 24-hour ask nobody can answer", async () => {
    expectTerminal(await run(requestConnection, { provider: "notion", reason: "to file the page" }));
  });

  it("still refuses an imaginary node type with a sentence, not a service failure", async () => {
    await expect(run(addNode, { type: "http.reqest" })).rejects.toThrow(/no node type/);
  });

  it("keeps working for the one tool that needs nothing but the plan gate", async () => {
    const result = (await run(listNodeTypes, { category: "trigger" })) as {
      nodes: { type: string }[];
    };
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});

describe("the Runtime agent's connector resolver", () => {
  /** The Agent node's step: `lib/eve.ts#mintEngineToken` puts the execution on the token. */
  const RUN = { orgId: "org_1", plan: "pro", executionId: "exec_1" };
  /** A person in the chat panel: a Clerk token carries `orgId` and `plan`, never an execution. */
  const CHAT = { orgId: "org_1", plan: "pro", executionId: "" };

  it("offers the org's connectors when the read succeeds", async () => {
    const tools = await resolveConnectorTools(RUN, async () => [
      { id: "conn_1", provider: "slack", label: "Papafam", status: "active" },
    ]);
    expect(Object.keys(tools).sort()).toEqual(["http_request", "slack_post"]);
  });

  it("degrades an interactive session to http_request and says why, rather than failing silently", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const tools = await resolveConnectorTools(CHAT, async () => {
      throw new EngineUnavailableError(
        "connections-engine: CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set",
      );
    });

    expect(Object.keys(tools)).toEqual(["http_request"]);
    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("org_1");
    expect(line).toContain("CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set");
    expect(line).toContain("http_request only");
  });

  it("fails a run instead of recording a success with none of the org's connectors", async () => {
    // A degraded Agent-node step would finish green, leaving `steps` and `executions` saying the
    // run worked. The throw keeps the step's retries — right for the transient half of these
    // failures — and the log line still names the cause.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      resolveConnectorTools(RUN, async () => {
        throw new EngineUnavailableError(
          "connections-engine: CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set",
        );
      }),
    ).rejects.toMatchObject({ name: "EngineUnavailableError" });

    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("exec_1");
    expect(line).toContain("CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set");
  });

  it("scrubs the failure it rethrows, because a step error is recorded on the run", async () => {
    // The Agent node turns this into the step's error, which lands on the `steps` row the canvas
    // reads — a client-visible query (CLAUDE.md rule 1).
    vi.spyOn(console, "error").mockImplementation(() => {});

    const thrown = await resolveConnectorTools(RUN, async () => {
      throw new Error('ArgumentValidationError: { secret: "shared-secret", orgId: "org_1" }');
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain("shared-secret");
    expect((thrown as Error).message).toContain("••••");
  });

  it("never repeats the shared secret into the log, whatever the failure said", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await resolveConnectorTools(CHAT, async () => {
      // Convex echoes the arguments it refused to validate, and one of them is the shared secret.
      throw new Error('ArgumentValidationError: { secret: "shared-secret", orgId: "org_1" }');
    });

    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).not.toContain("shared-secret");
    expect(line).toContain("••••");
  });

  it("gives a session with no organisation http_request and nothing else", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const list = vi.fn();

    const tools = await resolveConnectorTools({ ...RUN, orgId: "" }, list);

    expect(Object.keys(tools)).toEqual(["http_request"]);
    expect(list).not.toHaveBeenCalled();
    expect(String(logged.mock.calls[0]?.[0])).toContain("no orgId");
  });
});
