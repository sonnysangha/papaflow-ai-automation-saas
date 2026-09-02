import { describe, expect, it } from "vitest";

import { nextNodes, toRunGraph, unvisited } from "@/workflows/graph";
import type { RunGraph } from "@/workflows/types";

type StoredNodeLike = {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data: { nodeType: string; label?: string; inputs?: Record<string, unknown> };
};

function storedNode(id: string, nodeType: string, label = id): StoredNodeLike {
  return {
    id,
    type: "papaflow",
    position: { x: 0, y: 0 },
    data: { nodeType, label, inputs: {} },
  };
}

function storedEdge(
  source: string,
  target: string,
  sourceHandle?: string,
): { id: string; source: string; target: string; sourceHandle?: string } {
  return {
    id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

/** trigger → a → b, plus whatever extra nodes/edges a test needs. */
function linearGraph(): RunGraph {
  return toRunGraph({
    nodes: [
      storedNode("t", "manual.trigger"),
      storedNode("a", "http.request"),
      storedNode("b", "email.send"),
    ],
    edges: [storedEdge("t", "a"), storedEdge("a", "b")],
    triggerId: "t",
  });
}

describe("toRunGraph", () => {
  it("keys nodes by id and keeps the stored edges", () => {
    const graph = linearGraph();

    expect(Object.keys(graph.nodes).sort()).toEqual(["a", "b", "t"]);
    expect(graph.nodes.a).toEqual({
      id: "a",
      type: "papaflow",
      data: { nodeType: "http.request", label: "a", inputs: {} },
    });
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ source: "t", target: "a" });
  });

  it("uses the stored triggerId when that node still exists", () => {
    const graph = toRunGraph({
      nodes: [storedNode("t1", "manual.trigger"), storedNode("t2", "manual.trigger")],
      edges: [],
      triggerId: "t2",
    });

    expect(graph.triggerId).toBe("t2");
  });

  it("falls back to the first trigger-category node when triggerId is missing", () => {
    const graph = toRunGraph({
      nodes: [
        storedNode("a", "http.request"),
        storedNode("t1", "manual.trigger"),
        storedNode("t2", "manual.trigger"),
      ],
      edges: [],
    });

    expect(graph.triggerId).toBe("t1");
  });

  it("falls back to a trigger-category node when triggerId points at a deleted node", () => {
    const graph = toRunGraph({
      nodes: [storedNode("a", "http.request"), storedNode("t", "manual.trigger")],
      edges: [],
      triggerId: "gone",
    });

    expect(graph.triggerId).toBe("t");
  });

  it("throws when the graph has no trigger node", () => {
    expect(() =>
      toRunGraph({
        nodes: [storedNode("a", "http.request"), storedNode("b", "email.send")],
        edges: [storedEdge("a", "b")],
      }),
    ).toThrow("no trigger node");

    expect(() => toRunGraph({ nodes: [], edges: [] })).toThrow("no trigger node");
  });

  it("ignores nodes whose type is not in the registry when picking the trigger", () => {
    expect(() =>
      toRunGraph({ nodes: [storedNode("x", "does.notExist")], edges: [] }),
    ).toThrow("no trigger node");
  });

  it("drops malformed nodes and edges instead of crashing on stored JSON", () => {
    const graph = toRunGraph({
      nodes: [
        storedNode("t", "manual.trigger"),
        { id: "", data: { nodeType: "http.request" } },
        { id: "no-type", data: { nodeType: "" } },
        null,
        "nope",
      ],
      edges: [storedEdge("t", "t"), { id: "bad", source: "t" }, 42],
    });

    expect(Object.keys(graph.nodes)).toEqual(["t"]);
    expect(graph.edges).toHaveLength(1);
  });
});

describe("nextNodes", () => {
  it("walks a linear graph one node at a time", () => {
    const graph = linearGraph();

    expect(nextNodes(graph, graph.triggerId, null)).toEqual(["a"]);
    expect(nextNodes(graph, "a", null)).toEqual(["b"]);
    expect(nextNodes(graph, "b", null)).toEqual([]);
  });

  it("treats a missing handle and the default 'out' handle as the same edge", () => {
    const graph = toRunGraph({
      nodes: [storedNode("t", "manual.trigger"), storedNode("a", "http.request")],
      edges: [storedEdge("t", "a", "out")],
    });

    expect(nextNodes(graph, "t", null)).toEqual(["a"]);
    expect(nextNodes(graph, "t", undefined)).toEqual(["a"]);
    expect(nextNodes(graph, "t", "out")).toEqual(["a"]);
  });

  it("follows only the branch matching the handle", () => {
    const graph = toRunGraph({
      nodes: [
        storedNode("t", "manual.trigger"),
        storedNode("cond", "http.request"),
        storedNode("yes", "email.send"),
        storedNode("no", "email.send"),
      ],
      edges: [
        storedEdge("t", "cond"),
        storedEdge("cond", "yes", "true"),
        storedEdge("cond", "no", "false"),
      ],
    });

    expect(nextNodes(graph, "cond", "true")).toEqual(["yes"]);
    expect(nextNodes(graph, "cond", "false")).toEqual(["no"]);
    // A handle nothing is wired to ends that branch.
    expect(nextNodes(graph, "cond", "maybe")).toEqual([]);
    // Handled edges are not reachable through the default handle.
    expect(nextNodes(graph, "cond", null)).toEqual([]);
  });

  it("fans out to every target on the same handle, in edge order", () => {
    const graph = toRunGraph({
      nodes: [
        storedNode("t", "manual.trigger"),
        storedNode("a", "http.request"),
        storedNode("b", "email.send"),
        storedNode("c", "email.send"),
      ],
      edges: [storedEdge("t", "a"), storedEdge("t", "b"), storedEdge("t", "c")],
    });

    expect(nextNodes(graph, "t", null)).toEqual(["a", "b", "c"]);
  });

  it("returns each target once even when two edges connect the same pair", () => {
    const graph = toRunGraph({
      nodes: [storedNode("t", "manual.trigger"), storedNode("a", "http.request")],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "t", target: "a" },
      ],
    });

    expect(nextNodes(graph, "t", null)).toEqual(["a"]);
  });

  it("ignores a dangling edge whose target node is gone", () => {
    const graph = toRunGraph({
      nodes: [storedNode("t", "manual.trigger"), storedNode("a", "http.request")],
      edges: [storedEdge("t", "a"), storedEdge("t", "deleted")],
    });

    expect(graph.edges).toHaveLength(2);
    expect(nextNodes(graph, "t", null)).toEqual(["a"]);
  });

  it("returns nothing for a node that is not in the graph", () => {
    expect(nextNodes(linearGraph(), "ghost", null)).toEqual([]);
  });
});

describe("unvisited", () => {
  it("lists the node ids the walk never reached", () => {
    const graph = toRunGraph({
      nodes: [
        storedNode("t", "manual.trigger"),
        storedNode("a", "http.request"),
        storedNode("b", "email.send"),
        storedNode("orphan", "email.send"),
      ],
      edges: [storedEdge("t", "a"), storedEdge("a", "b")],
    });

    expect(unvisited(graph, new Set(["t", "a", "b"]))).toEqual(["orphan"]);
    expect(unvisited(graph, new Set(["t"]))).toEqual(["a", "b", "orphan"]);
    expect(unvisited(graph, new Set(["t", "a", "b", "orphan"]))).toEqual([]);
    expect(unvisited(graph, new Set())).toEqual(["t", "a", "b", "orphan"]);
  });
});
