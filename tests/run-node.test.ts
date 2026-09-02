import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { z } from "zod";

import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getStep, markStep } from "@/lib/engine-client";
import { REDACTED } from "@/lib/redact";
import { openFresh } from "@/lib/vault";
import { ConnectorError, type AnyNodeDef, type RunContext } from "@/nodes/define";
import { runNode } from "@/workflows/steps/run-node";
import type { NodeInput } from "@/workflows/types";

/**
 * `runNode` is a step, so the module-level imports it needs at runtime are the two things a unit
 * test cannot provide: the Workflow SDK's step context (`getStepMetadata()` throws outside a real
 * step) and a Convex deployment. Both are mocked; everything else — zod parsing, the redactor, the
 * error classification — is the real code.
 */
vi.mock("workflow", () => {
  class FatalError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FatalError";
    }
  }

  class RetryableError extends Error {
    constructor(
      message: string,
      readonly options?: { retryAfter?: unknown },
    ) {
      super(message);
      this.name = "RetryableError";
    }
  }

  return {
    FatalError,
    RetryableError,
    getStepMetadata: () => ({
      stepName: "runNode",
      stepId: "s1",
      stepStartedAt: new Date(0),
      attempt: 1,
    }),
    sleep: vi.fn(async () => {}),
    createHook: vi.fn(),
  } as unknown as typeof import("workflow");
});

vi.mock("@/lib/engine-client", () => ({
  getStep: vi.fn(async () => null),
  markStep: vi.fn(async () => {}),
}));

/** The vault is the other side of a Convex deployment, and it is what holds the plaintext. */
vi.mock("@/lib/vault", () => ({ openFresh: vi.fn() }));

/** The registry the step reads. Hoisted so the `vi.mock` factory can close over it. */
const { nodes } = vi.hoisted(() => ({ nodes: {} as Record<string, AnyNodeDef> }));
vi.mock("@/nodes/registry", () => ({ NODES: nodes }));

const getStepMock = vi.mocked(getStep);
const markStepMock = vi.mocked(markStep);
const openFreshMock = vi.mocked(openFresh);

/** What a sealed AI connection looks like once the step has opened it. */
function opened(overrides: Partial<Awaited<ReturnType<typeof openFresh>>> = {}) {
  return {
    orgId: "org_1",
    provider: "openai",
    kind: "apiKey",
    secret: { apiKey: "sk-live-xyz" },
    status: "active" as const,
    ...overrides,
  };
}

type TestInputs = { url: string; apiKey?: string };

const run = vi.fn(async (ctx: RunContext<TestInputs>) => ({ ok: ctx.inputs.url.length > 0 }));

/** A stand-in connector: one required URL, one secret-looking field, one boolean output. */
function installNode(overrides: Partial<AnyNodeDef> = {}): void {
  nodes["test.node"] = {
    type: "test.node",
    name: "Test node",
    description: "",
    category: "action",
    icon: "Box",
    credential: null,
    requiresFeature: null,
    version: "v1",
    inputs: z.object({ url: z.url(), apiKey: z.string().optional() }),
    outputs: z.object({ ok: z.boolean() }),
    run,
    ...overrides,
  } as AnyNodeDef;
}

function nodeInput(
  inputs: Record<string, unknown>,
  rest: Partial<NodeInput> = {},
): NodeInput {
  return {
    nodeId: "n1",
    nodeType: "test.node",
    executionId: "exec_1",
    orgId: "org_1",
    planSlug: "free_org",
    node: {
      id: "n1",
      type: "papaflow",
      data: { nodeType: "test.node", key: "test_node_1", label: "Test", inputs },
    },
    outputs: {},
    trigger: { type: "manual", payload: {} },
    ...rest,
  };
}

function storedStep(overrides: Partial<Doc<"steps">>): Doc<"steps"> {
  return {
    _id: "step_1" as Id<"steps">,
    _creationTime: 0,
    orgId: "org_1",
    executionId: "exec_1" as Id<"executions">,
    nodeId: "n1",
    nodeType: "test.node",
    status: "success",
    attempt: 1,
    startedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getStepMock.mockResolvedValue(null);
  // `markStep` hands back the row's id, which `runNode` passes to `run` as `stepId`.
  markStepMock.mockResolvedValue("step_1" as Id<"steps">);
  openFreshMock.mockResolvedValue(opened());
  run.mockImplementation(async (ctx) => ({ ok: ctx.inputs.url.length > 0 }));
  for (const key of Object.keys(nodes)) delete nodes[key];
  installNode();
});

describe("runNode", () => {
  it("marks the step running, runs the node, then marks it success with redacted input", async () => {
    const result = await runNode(
      nodeInput({ url: "https://api.example.com/things", apiKey: "sk-live-123" }),
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({
      inputs: { url: "https://api.example.com/things", apiKey: "sk-live-123" },
      credential: undefined,
      orgId: "org_1",
      executionId: "exec_1",
      nodeId: "n1",
    });

    expect(markStepMock).toHaveBeenCalledTimes(2);
    expect(markStepMock.mock.calls[0][0]).toMatchObject({
      executionId: "exec_1",
      orgId: "org_1",
      nodeId: "n1",
      nodeType: "test.node",
      status: "running",
      attempt: 1,
    });
    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "success",
      attempt: 1,
      // The key the user typed a token into never reaches the step row or the run log.
      input: { url: "https://api.example.com/things", apiKey: REDACTED },
      output: { ok: true },
      warnings: [],
    });

    expect(result).toEqual({ nodeId: "n1", output: { ok: true }, handle: null, control: undefined });
  });

  it("marks the step waiting, with its hook token, when the node asks for a hook", async () => {
    installNode({ control: () => ({ kind: "hook" }) });

    const result = await runNode(nodeInput({ url: "https://api.example.com/things" }));

    // `${executionId}:${nodeId}` — the address `runGraph` opens the hook on and the resume route
    // finds this row by (`steps.by_hookToken`).
    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "waiting",
      hookToken: "exec_1:n1",
    });
    expect(result.control).toEqual({ kind: "hook" });
  });

  it("leaves no hook token on a node that does not suspend", async () => {
    await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "success" });
    expect(markStepMock.mock.calls[1][0].hookToken).toBeUndefined();
  });

  it("hands the node its own hook token, so a node that posts buttons can address itself", async () => {
    await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(run.mock.calls[0][0]).toMatchObject({ hookToken: "exec_1:n1" });
  });

  it("records the handle a branching node returns", async () => {
    installNode({ handle: (out: { ok: boolean }) => (out.ok ? "true" : "false") });

    const result = await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(result.handle).toBe("true");
    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "success", handle: "true" });
  });

  it("turns a 429 into a RetryableError that honours Retry-After", async () => {
    run.mockRejectedValue(new ConnectorError("Rate limited", 429, "12"));

    const error = await runNode(nodeInput({ url: "https://api.example.com/things" })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(RetryableError);
    expect((error as { options?: { retryAfter?: unknown } }).options).toEqual({ retryAfter: 12_000 });
    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "failed", error: "Rate limited" });
  });

  it("falls back to 30s when the service did not say when to retry", async () => {
    run.mockRejectedValue(new ConnectorError("Rate limited", 429));

    const error = await runNode(nodeInput({ url: "https://api.example.com/things" })).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as { options?: { retryAfter?: unknown } }).options).toEqual({ retryAfter: "30s" });
  });

  it("turns any other 4xx into a FatalError", async () => {
    run.mockRejectedValue(new ConnectorError("Not found", 404));

    const error = await runNode(nodeInput({ url: "https://api.example.com/things" })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(FatalError);
    expect(error).not.toBeInstanceOf(RetryableError);
  });

  it("rethrows a 5xx so the SDK's default retries apply", async () => {
    const upstream = new ConnectorError("Bad gateway", 502);
    run.mockRejectedValue(upstream);

    const error = await runNode(nodeInput({ url: "https://api.example.com/things" })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBe(upstream);
  });

  it("turns invalid node configuration into a FatalError without running the node", async () => {
    const error = await runNode(nodeInput({ url: "not-a-url" })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(FatalError);
    expect(run).not.toHaveBeenCalled();
    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "failed" });
  });

  it("refuses an unknown node type without touching the step row", async () => {
    const error = await runNode({ ...nodeInput({}), nodeType: "does.not.exist" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(FatalError);
    expect(markStepMock).not.toHaveBeenCalled();
  });

  it("returns the stored output instead of running a node that already succeeded", async () => {
    installNode({ control: (out: { ok: boolean }) => (out.ok ? { kind: "hook" } : undefined) });
    getStepMock.mockResolvedValue(
      storedStep({ status: "success", output: { ok: true }, handle: "true" }),
    );

    const result = await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(run).not.toHaveBeenCalled();
    expect(markStepMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      nodeId: "n1",
      output: { ok: true },
      handle: "true",
      // Recomputed from the definition rather than stored.
      control: { kind: "hook" },
    });
  });

  it("re-runs a node whose stored row is not a success", async () => {
    getStepMock.mockResolvedValue(storedStep({ status: "failed", error: "boom" }));

    await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(markStepMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * The credential half of the step (CLAUDE.md rules 1 and 3): a node that declares a `credential`
 * has its connection opened here, inside the step, and the plan snapshotted on the execution is the
 * last word on whether the node — or the connection — may run at all.
 */
describe("runNode credentials and plan gating", () => {
  /** A node that needs an AI connection: `connectionId` is an input like any other. */
  function installCredentialNode(overrides: Partial<AnyNodeDef> = {}): void {
    installNode({
      credential: "ai",
      inputs: z.object({ connectionId: z.string() }),
      ...overrides,
    });
  }

  const withConnection = { connectionId: "conn_1" };

  it("does not open a connection for a node that declares no credential", async () => {
    await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(openFreshMock).not.toHaveBeenCalled();
    expect(run.mock.calls[0][0].credential).toBeUndefined();
  });

  it("opens the connection and hands the node its provider, kind and secret", async () => {
    installCredentialNode();
    run.mockImplementation(async () => ({ ok: true }));

    await runNode(nodeInput(withConnection));

    expect(openFreshMock).toHaveBeenCalledWith("conn_1");
    expect(run.mock.calls[0][0].credential).toEqual({
      provider: "openai",
      kind: "apiKey",
      apiKey: "sk-live-xyz",
    });
  });

  it("opens any provider's connection for a node whose credential is \"any\"", async () => {
    // The HTTP node takes whatever single token the user points it at, so the step must not
    // second-guess the provider the row turned out to hold.
    installCredentialNode({ credential: "any" });
    openFreshMock.mockResolvedValue(
      opened({ provider: "slack", kind: "botToken", secret: { botToken: "xoxb-live" } }),
    );
    run.mockImplementation(async () => ({ ok: true }));

    const result = await runNode(nodeInput(withConnection));

    expect(result.output).toEqual({ ok: true });
    expect(run.mock.calls[0][0].credential).toEqual({
      provider: "slack",
      kind: "botToken",
      botToken: "xoxb-live",
    });
  });

  it("never lets the opened secret reach the step row or the run log", async () => {
    installCredentialNode();
    run.mockImplementation(async () => ({ ok: true }));

    await runNode(nodeInput(withConnection));

    const success = markStepMock.mock.calls[1][0];
    expect(success).toMatchObject({ status: "success", input: { connectionId: "conn_1" } });
    expect(success.input).not.toHaveProperty("apiKey");
    expect(JSON.stringify(markStepMock.mock.calls)).not.toContain("sk-live-xyz");
  });

  it("refuses a connection that belongs to another org", async () => {
    installCredentialNode();
    openFreshMock.mockResolvedValue(opened({ orgId: "org_other" }));

    const error = await runNode(nodeInput(withConnection)).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FatalError);
    expect((error as Error).message).toBe("connection not found");
    expect(run).not.toHaveBeenCalled();
    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "failed",
      error: "connection not found",
    });
  });

  it("fails a node that needs a connection before one has been chosen", async () => {
    installCredentialNode({ inputs: z.object({ connectionId: z.string().optional() }) });

    const error = await runNode(nodeInput({})).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FatalError);
    expect(openFreshMock).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a node whose requiresFeature the execution's plan does not cover", async () => {
    installCredentialNode({ requiresFeature: "pro_connectors" });

    const error = await runNode(nodeInput(withConnection)).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FatalError);
    expect((error as Error).message).toBe("Upgrade required: pro_connectors");
    // The gate runs before the vault: a plan that cannot use the node never opens its secret.
    expect(openFreshMock).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "failed",
      error: "Upgrade required: pro_connectors",
    });
  });

  it("runs that same node once the plan covers the feature", async () => {
    installCredentialNode({ requiresFeature: "pro_connectors" });
    run.mockImplementation(async () => ({ ok: true }));

    const result = await runNode(nodeInput(withConnection, { planSlug: "pro" }));

    expect(result.output).toEqual({ ok: true });
    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "success" });
  });

  it("refuses a connection whose requiresFeature the plan does not cover", async () => {
    installCredentialNode();
    openFreshMock.mockResolvedValue({
      ...opened(),
      requiresFeature: "pro_connectors",
    } as Awaited<ReturnType<typeof openFresh>>);

    const error = await runNode(nodeInput(withConnection)).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FatalError);
    expect((error as Error).message).toBe("Upgrade required: pro_connectors");
    expect(run).not.toHaveBeenCalled();
  });

  it("does not re-open a connection for a node that already succeeded", async () => {
    installCredentialNode();
    getStepMock.mockResolvedValue(storedStep({ status: "success", output: { ok: true } }));

    await runNode(nodeInput(withConnection));

    expect(openFreshMock).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

/**
 * The templates half of the step: `node.data.inputs` is resolved against the run's outputs (keyed
 * by node *key*, not id) plus the two reserved roots before zod ever sees it. `nodes/templates.ts`
 * has its own unit tests; these pin the wiring — which context the step builds, and what happens to
 * the warnings it comes back with.
 */
describe("runNode templates", () => {
  it("resolves a template against an upstream node's output before parsing", async () => {
    await runNode(
      nodeInput(
        { url: "https://api.example.com/{{ http_request_1.body.path }}" },
        { outputs: { http_request_1: { body: { path: "things" } } } },
      ),
    );

    expect(run.mock.calls[0][0].inputs).toEqual({ url: "https://api.example.com/things" });
    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "success", warnings: [] });
  });

  it("resolves the reserved trigger root from the payload that started the run", async () => {
    await runNode(
      nodeInput(
        { url: "https://api.example.com/{{ trigger.path }}" },
        { trigger: { type: "manual", payload: { path: "leads" } } },
      ),
    );

    expect(run.mock.calls[0][0].inputs.url).toBe("https://api.example.com/leads");
  });

  it("resolves the reserved $item root for a node running over one item", async () => {
    await runNode(
      nodeInput({ url: "https://api.example.com/{{ $item.id }}" }, { item: { id: "42" } }),
    );

    expect(run.mock.calls[0][0].inputs.url).toBe("https://api.example.com/42");
  });

  it("keeps the raw type of an input that is exactly one template", async () => {
    installNode({ inputs: z.object({ payload: z.any() }) });
    run.mockImplementation(async () => ({ ok: true }));

    await runNode(
      nodeInput(
        { payload: "{{ http_request_1.body }}" },
        { outputs: { http_request_1: { body: { items: [1, 2], ok: true } } } },
      ),
    );

    // Not the JSON text of the body: the object itself, so the schema can be anything but a string.
    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "success",
      input: { payload: { items: [1, 2], ok: true } },
    });
  });

  it("stores a warning on the step row when a path is not there", async () => {
    await runNode(nodeInput({ url: "https://api.example.com/{{ nope.field }}" }));

    // A missing path resolves to "" and the node still runs: the row is what explains the gap.
    expect(run.mock.calls[0][0].inputs.url).toBe("https://api.example.com/");
    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "success",
      warnings: ["{{ nope.field }}: not found"],
    });
  });

  it("stores the warnings of a node that is left waiting on a hook", async () => {
    installNode({ control: () => ({ kind: "hook" }) });

    await runNode(nodeInput({ url: "https://api.example.com/{{ nope.field }}" }));

    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "waiting",
      warnings: ["{{ nope.field }}: not found"],
    });
  });

  it("still fails the step when a resolved input does not match the schema", async () => {
    const error = await runNode(nodeInput({ url: "{{ nope.url }}" })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(FatalError);
    expect(run).not.toHaveBeenCalled();
    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "failed" });
  });
});

/**
 * A node on a Loop body runs once per item, so "the step row for this node" is no longer enough to
 * identify it: `iteration` is part of the row's address. Without that, the guard above — which is
 * what makes a step safe to re-run (CLAUDE.md rule 7) — would hand pass 2 the answer pass 1 stored.
 */
describe("runNode inside a loop body", () => {
  const onItem = (rest: Partial<NodeInput>) =>
    nodeInput({ url: "https://api.example.com/{{ $item.id }}" }, rest);

  it("looks up, and writes, the row for this pass", async () => {
    await runNode(onItem({ item: { id: "b" }, iteration: 1 }));

    expect(getStepMock).toHaveBeenCalledWith("exec_1", "n1", 1);
    expect(markStepMock.mock.calls[0][0]).toMatchObject({ status: "running", iteration: 1 });
    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "success", iteration: 1 });
  });

  it("does not short-circuit a later pass with an earlier one's output", async () => {
    // The row for pass 0 exists and succeeded; pass 1 has no row yet, and must actually run.
    getStepMock.mockImplementation(async (_executionId, _nodeId, iteration) =>
      iteration === 0 ? storedStep({ status: "success", output: { ok: false } }) : null,
    );

    const first = await runNode(onItem({ item: { id: "a" }, iteration: 0 }));
    const second = await runNode(onItem({ item: { id: "b" }, iteration: 1 }));

    expect(first.output).toEqual({ ok: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].inputs.url).toBe("https://api.example.com/b");
    expect(second.output).toEqual({ ok: true });
  });

  it("still returns the stored output when this very pass already succeeded", async () => {
    getStepMock.mockResolvedValue(storedStep({ status: "success", output: { ok: true } }));

    const result = await runNode(onItem({ item: { id: "a" }, iteration: 2 }));

    expect(run).not.toHaveBeenCalled();
    expect(result.output).toEqual({ ok: true });
  });

  it("gives each pass a hook token of its own", async () => {
    installNode({ control: () => ({ kind: "hook" }) });

    await runNode(onItem({ item: { id: "a" }, iteration: 3 }));

    // `steps.by_hookToken` is a unique lookup: two waiting rows may not share an address.
    expect(run.mock.calls[0][0]).toMatchObject({ hookToken: "exec_1:n1:3" });
    expect(markStepMock.mock.calls[1][0]).toMatchObject({
      status: "waiting",
      hookToken: "exec_1:n1:3",
      iteration: 3,
    });
  });

  it("records a failed pass against its own row", async () => {
    run.mockRejectedValue(new ConnectorError("Not found", 404));

    await runNode(onItem({ item: { id: "a" }, iteration: 1 })).catch(() => undefined);

    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "failed", iteration: 1 });
  });
});

/**
 * The Loop hand-off: a node that expands the run returns the list it is iterating alongside its
 * output, because the orchestrator cannot ask a step for anything else.
 */
describe("runNode expansion", () => {
  /** A stand-in Loop: `items` in, a count out, the list on the side. */
  function installLoop(): void {
    installNode({
      inputs: z.object({ items: z.any() }),
      outputs: z.object({ count: z.number() }),
      expand: (inputs: { items: unknown[] }) => inputs.items,
      run: vi.fn(async (ctx: RunContext<{ items: unknown[] }>) => ({
        count: ctx.inputs.items.length,
      })),
    });
  }

  it("returns the items a node expands into, resolved from the run's outputs", async () => {
    installLoop();

    const result = await runNode(
      nodeInput(
        { items: "{{ http_request_1.body }}" },
        { outputs: { http_request_1: { body: [{ id: 1 }, { id: 2 }] } } },
      ),
    );

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.output).toEqual({ count: 2 });
  });

  it("recomputes them for a replay that came back off its own step row", async () => {
    installLoop();
    // The row holds the loop's *output*, never the list — so the guard has to work it out again,
    // or the body would run zero times after a retry.
    getStepMock.mockResolvedValue(storedStep({ status: "success", output: { count: 2 } }));

    const result = await runNode(
      nodeInput(
        { items: "{{ http_request_1.body }}" },
        { outputs: { http_request_1: { body: [{ id: 1 }, { id: 2 }] } } },
      ),
    );

    expect(markStepMock).not.toHaveBeenCalled();
    expect(result.output).toEqual({ count: 2 });
    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("leaves `items` off every node that does not expand", async () => {
    const result = await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(result.items).toBeUndefined();
  });
});
