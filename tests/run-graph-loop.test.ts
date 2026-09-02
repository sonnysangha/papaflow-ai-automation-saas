import { beforeEach, describe, expect, it, vi } from "vitest";

import { DONE_HANDLE, EACH_HANDLE } from "@/nodes/logic/loop";
import { toRunGraph } from "@/workflows/graph";
import { runGraph } from "@/workflows/run-graph";
import { recordFinish, recordLoop, recordSkipped } from "@/workflows/steps/record";
import { runNode } from "@/workflows/steps/run-node";
import type { NodeInput, NodeResult } from "@/workflows/types";

/**
 * The orchestration half of Loop: what `runGraph` does with the items a Loop hands back.
 *
 * `runGraph` is `"use workflow"` code, which outside the Workflow SDK's compiler is an ordinary
 * async function — so the walk itself can be tested by mocking the two things it is made of: the
 * `runNode` step and the bookkeeping steps. Nothing here touches Convex or the SDK; the point is
 * the *order*, and the arguments each step is given.
 */

vi.mock("workflow", () => ({
  sleep: vi.fn(async () => {}),
  createHook: vi.fn(),
}));

vi.mock("@/workflows/steps/run-node", () => ({ runNode: vi.fn() }));

vi.mock("@/workflows/steps/record", () => ({
  recordFinish: vi.fn(async () => {}),
  recordLoop: vi.fn(async () => {}),
  recordResume: vi.fn(async () => {}),
  recordSkipped: vi.fn(async () => {}),
}));

const runNodeMock = vi.mocked(runNode);
const recordLoopMock = vi.mocked(recordLoop);
const recordSkippedMock = vi.mocked(recordSkipped);
const recordFinishMock = vi.mocked(recordFinish);

function node(id: string, nodeType: string, key: string) {
  return { id, type: "papaflow", position: { x: 0, y: 0 }, data: { nodeType, key } };
}

function edge(source: string, target: string, sourceHandle?: string) {
  return {
    id: `${source}->${target}${sourceHandle ?? ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

/** manual → loop, `each` → set → request, `done` → email. */
const graph = toRunGraph({
  nodes: [
    node("t", "manual.trigger", "manual_1"),
    node("loop", "logic.loop", "loop_1"),
    node("set", "logic.set", "set_1"),
    node("req", "http.request", "req_1"),
    node("mail", "email.send", "mail_1"),
  ],
  edges: [
    edge("t", "loop"),
    edge("loop", "set", EACH_HANDLE),
    edge("set", "req"),
    edge("loop", "mail", DONE_HANDLE),
  ],
  triggerId: "t",
});

/** Every node answers with its own id; the Loop also hands back the list it is iterating. */
function respond(items: unknown[]) {
  runNodeMock.mockImplementation(async (input: NodeInput): Promise<NodeResult> => {
    const base = { nodeId: input.nodeId, handle: null, control: undefined };
    if (input.nodeId === "loop") {
      return { ...base, output: { results: [], count: items.length }, items };
    }
    return { ...base, output: { from: input.nodeId, item: input.item, pass: input.iteration } };
  });
}

async function run() {
  return await runGraph({
    executionId: "exec_1",
    orgId: "org_1",
    planSlug: "free_org",
    graph,
    trigger: { type: "manual", payload: { hello: "world" } },
  });
}

/** The `(nodeId, iteration)` of every step the run took, in order. */
function calls(): [string, number | undefined][] {
  return runNodeMock.mock.calls.map(([input]) => [input.nodeId, input.iteration]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runGraph over a loop", () => {
  it("runs the body once per item, in order, then continues down `done`", async () => {
    respond(["a", "b", "c"]);

    expect(await run()).toEqual({ executionId: "exec_1", status: "completed" });

    // One pass of the whole body before the next one starts: this is a sequential loop.
    expect(calls()).toEqual([
      ["loop", undefined],
      ["set", 0],
      ["req", 0],
      ["set", 1],
      ["req", 1],
      ["set", 2],
      ["req", 2],
      ["mail", undefined],
    ]);
  });

  it("binds `$item` to the element and passes the pass number to every body node", async () => {
    respond([{ id: 1 }, { id: 2 }]);

    await run();

    const body = runNodeMock.mock.calls
      .map(([input]) => input)
      .filter((input) => input.nodeId === "set");
    expect(body.map((input) => input.item)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(body.map((input) => input.iteration)).toEqual([0, 1]);
  });

  it("collects the last body node's output into the loop's results", async () => {
    respond(["a", "b"]);

    await run();

    expect(recordLoopMock).toHaveBeenCalledTimes(1);
    expect(recordLoopMock.mock.calls[0]).toEqual([
      "exec_1",
      "loop",
      {
        count: 2,
        results: [
          { from: "req", item: "a", pass: 0 },
          { from: "req", item: "b", pass: 1 },
        ],
      },
    ]);
  });

  it("shows a body node the outputs of this pass only, and the loop's results downstream", async () => {
    respond(["a", "b"]);

    await run();

    const byNode = new Map(
      runNodeMock.mock.calls.map(([input]) => [`${input.nodeId}:${input.iteration}`, input.outputs]),
    );

    // The second body node sees the first one's output for the pass it is on…
    expect(byNode.get("req:1")).toMatchObject({ set_1: { from: "set", item: "b", pass: 1 } });
    // …and the node after the loop sees the loop's results, not the last pass's leftovers.
    const after = byNode.get("mail:undefined");
    expect(after).toMatchObject({ loop_1: { count: 2, results: [{ from: "req" }, { from: "req" }] } });
    expect(after).not.toHaveProperty("set_1");
    expect(after).not.toHaveProperty("req_1");
  });

  it("runs no body at all for an empty list, and records those nodes as skipped", async () => {
    respond([]);

    await run();

    expect(calls()).toEqual([
      ["loop", undefined],
      ["mail", undefined],
    ]);
    expect(recordLoopMock.mock.calls[0][2]).toEqual({ results: [], count: 0 });
    expect(recordSkippedMock).toHaveBeenCalledWith("exec_1", "org_1", ["set", "req"]);
    expect(recordFinishMock).toHaveBeenCalledWith("exec_1", "completed");
  });

  it("never lets a body node into the ordinary walk", async () => {
    // A body node wired to the trigger as well is still the loop's: it runs per item, not twice.
    const wired = toRunGraph({
      nodes: [
        node("t", "manual.trigger", "manual_1"),
        node("loop", "logic.loop", "loop_1"),
        node("set", "logic.set", "set_1"),
      ],
      edges: [edge("t", "loop"), edge("t", "set"), edge("loop", "set", EACH_HANDLE)],
      triggerId: "t",
    });
    respond(["a"]);

    await runGraph({
      executionId: "exec_1",
      orgId: "org_1",
      planSlug: "free_org",
      graph: wired,
      trigger: { type: "manual", payload: {} },
    });

    expect(calls()).toEqual([
      ["loop", undefined],
      ["set", 0],
    ]);
  });
});
