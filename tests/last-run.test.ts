import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { PAPAFLOW_NODE_TYPE, type WorkflowNodeType } from "@/components/canvas/graph-io";
import {
  carryOverSteps,
  lastRunFor,
  latestStepByNode,
  pathPreviews,
  previewOf,
  relativeTime,
  valueAt,
  type RunStepRow,
} from "@/components/canvas/last-run";
import { EACH_HANDLE } from "@/nodes/logic/loop";

function node(
  id: string,
  nodeType: string,
  key: string,
  label = key,
): WorkflowNodeType {
  return {
    id,
    type: PAPAFLOW_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { nodeType, key, label, inputs: {} },
  };
}

function edge(source: string, target: string, sourceHandle?: string): Edge {
  return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null };
}

function step(nodeId: string, over: Partial<RunStepRow> = {}): RunStepRow {
  return { nodeId, status: "success", startedAt: 1_000, finishedAt: 1_250, ...over };
}

/** trigger → http → email, the shape every workflow starts as. */
const CHAIN = {
  nodes: [
    node("t", "manual.trigger", "manual_trigger_1", "When I click Run"),
    node("h", "http.request", "http_request_1", "Fetch order"),
    node("e", "email.send", "email_send_1", "Email me"),
  ],
  edges: [edge("t", "h"), edge("h", "e")],
};

describe("previewOf", () => {
  it("shows scalars as written", () => {
    expect(previewOf(42)).toBe("42");
    expect(previewOf(true)).toBe("true");
    expect(previewOf(null)).toBe("null");
  });

  it("collapses whitespace and truncates a long string", () => {
    expect(previewOf("  hello   world \n")).toBe("hello world");
    expect(previewOf("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
    // An empty string has to look like a value rather than like a missing one.
    expect(previewOf("")).toBe('""');
  });

  it("describes a container by its shape, not its contents", () => {
    expect(previewOf([1, 2, 3])).toBe("[3 items]");
    expect(previewOf(["only"])).toBe("[1 item]");
    expect(previewOf([])).toBe("[0 items]");
    expect(previewOf({ a: 1 })).toBe("{…}");
    expect(previewOf({})).toBe("{}");
  });

  it("previews nothing for a value that is not there", () => {
    expect(previewOf(undefined)).toBe("");
  });
});

describe("valueAt", () => {
  const value = { body: { items: [{ id: "ord_1" }], total: 12 } };

  it("walks properties and array indices", () => {
    expect(valueAt(value, "body.total")).toBe(12);
    expect(valueAt(value, "body.items[0].id")).toBe("ord_1");
  });

  it("misses rather than inheriting", () => {
    expect(valueAt(value, "body.missing")).toBeUndefined();
    expect(valueAt(value, "toString")).toBeUndefined();
    expect(valueAt(undefined, "body")).toBeUndefined();
  });
});

describe("pathPreviews", () => {
  it("previews every path the value contains", () => {
    expect(pathPreviews({ status: 200, body: { id: "ord_1", tags: ["a", "b"] } })).toEqual([
      { path: "status", type: "number", preview: "200" },
      { path: "body", type: "object", preview: "{…}" },
      { path: "body.id", type: "string", preview: "ord_1" },
      { path: "body.tags", type: "array", preview: "[2 items]" },
      { path: "body.tags[0]", type: "string", preview: "a" },
    ]);
  });

  it("finds nothing inside a scalar output", () => {
    expect(pathPreviews("done")).toEqual([]);
    expect(pathPreviews(undefined)).toEqual([]);
  });
});

describe("latestStepByNode", () => {
  it("keeps the last pass of a loop body node", () => {
    const byNode = latestStepByNode([
      step("a", { iteration: 0, output: { i: 0 } }),
      step("a", { iteration: 1, output: { i: 1 } }),
    ]);
    expect(byNode.a.output).toEqual({ i: 1 });
  });

  it("ignores rows arriving out of order", () => {
    const byNode = latestStepByNode([
      step("a", { iteration: 2, output: { i: 2 } }),
      step("a", { iteration: 1, output: { i: 1 } }),
    ]);
    expect(byNode.a.output).toEqual({ i: 2 });
  });

  it("lets a retry of the same pass replace the attempt before it", () => {
    const byNode = latestStepByNode([
      step("a", { status: "failed", error: "boom" }),
      step("a", { status: "success", output: { ok: true } }),
    ]);
    expect(byNode.a.status).toBe("success");
  });

  it("skips the rows a node spawned — they are tool calls, not graph nodes", () => {
    const byNode = latestStepByNode([
      step("agent_1", { output: { text: "hi" } }),
      step("agent_1#0", { parentStepId: "s1", output: { tool: "search" } }),
    ]);
    expect(Object.keys(byNode)).toEqual(["agent_1"]);
  });
});

describe("carryOverSteps", () => {
  it("hands back the current rows untouched when there is nothing to carry", () => {
    const current = [step("a"), step("b")];
    // Same array, not a copy: the config panel memoises on this identity.
    expect(carryOverSteps([], current)).toBe(current);
  });

  it("keeps a node's last row until the new run reaches that node", () => {
    const previous = [step("a", { output: { n: 1 } }), step("b", { output: { n: 2 } })];
    const current = [step("a", { status: "running", finishedAt: undefined })];

    const byNode = latestStepByNode(carryOverSteps(previous, current));
    // `a` has been reached, so it speaks for itself; `b` still shows what it last produced.
    expect(byNode.a.status).toBe("running");
    expect(byNode.b.output).toEqual({ n: 2 });
  });

  it("drops a carried row the moment the same node runs again", () => {
    const previous = [step("a", { output: { n: 1 } })];
    const current = [step("a", { status: "failed", error: "boom", output: undefined })];

    const byNode = latestStepByNode(carryOverSteps(previous, current));
    expect(byNode.a.status).toBe("failed");
    expect(byNode.a.output).toBeUndefined();
  });

  it("never lets a previous run's loop pass outrank the new run's first one", () => {
    const previous = [
      step("a", { iteration: 0, output: { i: 0 } }),
      step("a", { iteration: 5, output: { i: 5 } }),
    ];
    const current = [step("a", { iteration: 0, output: { i: "new" } })];

    const byNode = latestStepByNode(carryOverSteps(previous, current));
    expect(byNode.a.output).toEqual({ i: "new" });
  });

  it("keeps carrying while the subscription has nothing at all to say", () => {
    const previous = [step("a", { output: { n: 1 } })];
    expect(carryOverSteps(previous, [])).toEqual(previous);
  });

  it("still speaks for a node the current run reached only in a spawned row", () => {
    // Rows a node spawned share its id with a `#index` suffix, so they are different node ids and
    // cannot hide the carried row of the node that spawned them.
    const previous = [step("agent_1", { output: { text: "old" } })];
    const current = [step("agent_1#0", { parentStepId: "s1", output: { tool: "search" } })];

    const byNode = latestStepByNode(carryOverSteps(previous, current));
    expect(byNode.agent_1.output).toEqual({ text: "old" });
  });
});

describe("lastRunFor", () => {
  it("lists every ancestor nearest first, then the reserved trigger root", () => {
    const run = lastRunFor({ nodeId: "e", ...CHAIN, steps: [] });
    expect(run.sources.map((source) => source.key)).toEqual([
      "http_request_1",
      "manual_trigger_1",
      "trigger",
    ]);
    expect(run.sources.map((source) => source.reserved)).toEqual([false, false, true]);
  });

  it("hands back each ancestor's last output with paths and previews", () => {
    const run = lastRunFor({
      nodeId: "e",
      ...CHAIN,
      steps: [
        step("t", { output: { order: "ord_1" } }),
        step("h", { output: { status: 200, body: { id: "ord_1" } } }),
      ],
    });

    const [http] = run.sources;
    expect(http).toMatchObject({
      nodeId: "h",
      key: "http_request_1",
      nodeType: "http.request",
      label: "Fetch order",
      ran: true,
      output: { status: 200, body: { id: "ord_1" } },
    });
    expect(http.paths).toEqual([
      { path: "status", type: "number", preview: "200" },
      { path: "body", type: "object", preview: "{…}" },
      { path: "body.id", type: "string", preview: "ord_1" },
    ]);

    // The trigger is an ancestor *and* the reserved root, so it is offered under both spellings.
    expect(run.sources[2]).toMatchObject({ nodeId: "t", key: "trigger", ran: true });
    expect(run.sources[2].paths).toEqual([
      { path: "order", type: "string", preview: "ord_1" },
    ]);
  });

  it("offers the trigger to a node nothing is wired to", () => {
    const loose = node("x", "logic.set", "set_1");
    const run = lastRunFor({
      nodeId: "x",
      nodes: [...CHAIN.nodes, loose],
      edges: CHAIN.edges,
      steps: [step("t", { output: { order: "ord_1" } })],
    });
    expect(run.sources.map((source) => source.key)).toEqual(["trigger"]);
    expect(run.sources[0].ran).toBe(true);
  });

  it("only offers the branch a node is actually on", () => {
    const nodes = [
      node("t", "manual.trigger", "manual_trigger_1"),
      node("c", "logic.condition", "logic_condition_1"),
      node("y", "logic.set", "yes_1"),
      node("n", "logic.set", "no_1"),
    ];
    const edges = [edge("t", "c"), edge("c", "y", "true"), edge("c", "n", "false")];

    const run = lastRunFor({ nodeId: "y", nodes, edges, steps: [] });
    expect(run.sources.map((source) => source.key)).toEqual([
      "logic_condition_1",
      "manual_trigger_1",
      "trigger",
    ]);
    expect(run.sources.some((source) => source.key === "no_1")).toBe(false);
  });

  it("shows the latest pass of a loop body node to what follows it", () => {
    const nodes = [
      node("t", "manual.trigger", "manual_trigger_1"),
      node("l", "logic.loop", "logic_loop_1"),
      node("b", "logic.set", "set_1"),
      node("s", "email.send", "email_send_1"),
    ];
    const edges = [edge("t", "l"), edge("l", "b", EACH_HANDLE), edge("b", "s")];

    const run = lastRunFor({
      nodeId: "s",
      nodes,
      edges,
      steps: [
        step("b", { iteration: 0, output: { name: "first" } }),
        step("b", { iteration: 1, output: { name: "second" } }),
      ],
    });

    const body = run.sources.find((source) => source.key === "set_1");
    expect(body?.output).toEqual({ name: "second" });
    expect(body?.paths).toEqual([{ path: "name", type: "string", preview: "second" }]);
  });

  it("reports the selected node's own input, output and duration", () => {
    const run = lastRunFor({
      nodeId: "h",
      ...CHAIN,
      steps: [
        step("h", {
          status: "failed",
          // Exactly as the engine stored it: templates resolved, secrets already masked.
          input: { url: "https://api.example.com/orders/ord_1", headers: { authorization: "••••" } },
          output: undefined,
          error: "500 from api.example.com",
          startedAt: 1_000,
          finishedAt: 1_900,
        }),
      ],
    });

    expect(run.self).toEqual({
      status: "failed",
      input: { url: "https://api.example.com/orders/ord_1", headers: { authorization: "••••" } },
      output: undefined,
      error: "500 from api.example.com",
      iteration: undefined,
      startedAt: 1_000,
      finishedAt: 1_900,
      durationMs: 900,
    });
  });

  it("leaves the duration open while the step is still going", () => {
    const run = lastRunFor({
      nodeId: "h",
      ...CHAIN,
      steps: [step("h", { status: "running", finishedAt: undefined })],
    });
    expect(run.self?.durationMs).toBeUndefined();
  });

  it("is empty before the workflow has ever run", () => {
    const run = lastRunFor({ nodeId: "e", ...CHAIN, steps: [] });
    expect(run.self).toBeNull();
    expect(run.sources.every((source) => !source.ran && source.paths.length === 0)).toBe(true);
    expect(run.sources.every((source) => source.output === undefined)).toBe(true);
  });

  it("keeps a non-object output whole, with no paths under it", () => {
    const run = lastRunFor({
      nodeId: "e",
      ...CHAIN,
      steps: [step("h", { output: "queued" })],
    });
    const http = run.sources[0];
    expect(http.output).toBe("queued");
    expect(http.ran).toBe(true);
    expect(http.paths).toEqual([]);
  });

  it("skips an ancestor that has no key to be referenced by", () => {
    const keyless = { ...node("h", "http.request", ""), data: { ...CHAIN.nodes[1].data, key: "" } };
    const run = lastRunFor({
      nodeId: "e",
      nodes: [CHAIN.nodes[0], keyless, CHAIN.nodes[2]],
      edges: CHAIN.edges,
      steps: [],
    });
    expect(run.sources.map((source) => source.key)).toEqual(["manual_trigger_1", "trigger"]);
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000;

  it("rounds to the unit a person would say", () => {
    expect(relativeTime(now - 4_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("does not read the future off a clock that is behind", () => {
    expect(relativeTime(now + 4_000, now)).toBe("just now");
  });
});
