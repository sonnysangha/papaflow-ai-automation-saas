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

const { EngineUnavailableError } = await import("@/lib/engine-env");
const { resolveConnectorTools } = await import("@/agents/runtime/lib/connector-session");
const { isToolFailure, serviceUnavailable, toolResult, viaEngine } = await import(
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
  const SESSION = { orgId: "org_1", plan: "pro", executionId: "exec_1" };

  it("offers the org's connectors when the read succeeds", async () => {
    const tools = await resolveConnectorTools(SESSION, async () => [
      { id: "conn_1", provider: "slack", label: "Papafam", status: "active" },
    ]);
    expect(Object.keys(tools).sort()).toEqual(["http_request", "slack_post"]);
  });

  it("degrades to http_request and says why, rather than failing silently", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const tools = await resolveConnectorTools(SESSION, async () => {
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

  it("never repeats the shared secret into the log, whatever the failure said", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await resolveConnectorTools(SESSION, async () => {
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

    const tools = await resolveConnectorTools({ ...SESSION, orgId: "" }, list);

    expect(Object.keys(tools)).toEqual(["http_request"]);
    expect(list).not.toHaveBeenCalled();
    expect(String(logged.mock.calls[0]?.[0])).toContain("no orgId");
  });
});
