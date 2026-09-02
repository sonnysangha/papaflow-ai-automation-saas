import { describe, expect, it } from "vitest";

import { nextNodes, toRunGraph, unvisited } from "@/workflows/graph";
import type { RunGraph } from "@/workflows/types";

type StoredNodeLike = {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data: { nodeType: string; key?: unknown; label?: string; inputs?: Record<string, unknown> };
};

function storedNode(id: string, nodeType: string, label = id): StoredNodeLike {
  return {
    id,
    type: "papaflow",
    position: { x: 0, y: 0 },
    data: { nodeType, label, inputs: {} },
  };
}

/** A node as the canvas saves it today: with the key it generated on drop. */
function keyedNode(id: string, nodeType: string, key: unknown): StoredNodeLike {
  const node = storedNode(id, nodeType);
  return { ...node, data: { ...node.data, key } };
}

function keysOf(graph: RunGraph): Record<string, string> {
  return Object.fromEntries(Object.values(graph.nodes).map((node) => [node.id, node.data.key]));
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
      data: { nodeType: "http.request", key: "http_request_2", label: "a", inputs: {} },
    });
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ source: "t", target: "a" });
  });

  it("keeps the key the canvas generated", () => {
    const graph = toRunGraph({
      nodes: [
        keyedNode("t", "manual.trigger", "manual_trigger_1"),
        keyedNode("a", "http.request", "fetch_lead"),
        keyedNode("b", "email.send", "email_send_1"),
      ],
      edges: [],
      triggerId: "t",
    });

    expect(keysOf(graph)).toEqual({
      t: "manual_trigger_1",
      a: "fetch_lead",
      b: "email_send_1",
    });
  });

  it("derives a key for a node saved before keys existed", () => {
    // `<nodeType with '.' → '_'>_<index + 1>`: the same stored graph always produces the same
    // keys, so a template written against a migrated graph keeps working.
    const stored = {
      nodes: [
        storedNode("t", "manual.trigger"),
        storedNode("a", "http.request"),
        storedNode("b", "http.request"),
      ],
      edges: [],
      triggerId: "t",
    };

    expect(keysOf(toRunGraph(stored))).toEqual({
      t: "manual_trigger_1",
      a: "http_request_2",
      b: "http_request_3",
    });
    expect(keysOf(toRunGraph(stored))).toEqual(keysOf(toRunGraph(stored)));
  });

  it("derives a key when the stored one could never appear in a template", () => {
    const graph = toRunGraph({
      nodes: [
        keyedNode("t", "manual.trigger", "Manual Trigger"),
        keyedNode("a", "http.request", "9lives"),
        keyedNode("b", "email.send", ""),
        keyedNode("c", "email.send", 7),
      ],
      edges: [],
      triggerId: "t",
    });

    expect(keysOf(graph)).toEqual({
      t: "manual_trigger_1",
      a: "http_request_2",
      b: "email_send_3",
      c: "email_send_4",
    });
  });

  it("keeps keys unique when two nodes claim the same one", () => {
    const graph = toRunGraph({
      nodes: [
        keyedNode("t", "manual.trigger", "manual_trigger_1"),
        keyedNode("a", "http.request", "lookup"),
        keyedNode("b", "http.request", "lookup"),
      ],
      edges: [],
      triggerId: "t",
    });

    expect(keysOf(graph)).toEqual({
      t: "manual_trigger_1",
      a: "lookup",
      b: "http_request_3",
    });
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
