import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { z } from "zod";

import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getStep, markStep } from "@/lib/engine-client";
import { REDACTED } from "@/lib/redact";
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

/** The registry the step reads. Hoisted so the `vi.mock` factory can close over it. */
const { nodes } = vi.hoisted(() => ({ nodes: {} as Record<string, AnyNodeDef> }));
vi.mock("@/nodes/registry", () => ({ NODES: nodes }));

const getStepMock = vi.mocked(getStep);
const markStepMock = vi.mocked(markStep);

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

function nodeInput(inputs: Record<string, unknown>): NodeInput {
  return {
    nodeId: "n1",
    nodeType: "test.node",
    executionId: "exec_1",
    orgId: "org_1",
    node: { id: "n1", type: "papaflow", data: { nodeType: "test.node", label: "Test", inputs } },
    outputs: {},
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
  markStepMock.mockResolvedValue(undefined);
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
    });

    expect(result).toEqual({ nodeId: "n1", output: { ok: true }, handle: null, control: undefined });
  });

  it("marks the step waiting when the node asks for a hook", async () => {
    installNode({ control: () => ({ kind: "hook" }) });

    const result = await runNode(nodeInput({ url: "https://api.example.com/things" }));

    expect(markStepMock.mock.calls[1][0]).toMatchObject({ status: "waiting" });
    expect(result.control).toEqual({ kind: "hook" });
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
