import { describe, expect, it } from "vitest";

import { ConnectorError, type RunContext } from "@/nodes/define";
import { DONE_HANDLE, EACH_HANDLE, loopItems, loopNode } from "@/nodes/logic/loop";
import {
  isLoopNode,
  loopBody,
  loopBodyNodes,
  loopFor,
  loopNodeIds,
  toRunGraph,
} from "@/workflows/graph";
import { hookTokenFor, type RunGraph } from "@/workflows/types";

/**
 * The Loop node and the pure helpers `runGraph` drives it with.
 *
 * Everything here is deterministic on purpose: deciding what a loop's *body* is has to be a
 * function of the stored graph alone, because it runs inside the Workflow SDK's sandbox on every
 * replay (CLAUDE.md rule 4). The orchestration itself — one pass per item, `{{ $item }}` bound to
 * the element, one step row per node per pass — is exercised through `runNode` in
 * `tests/run-node.test.ts` and through `convex/engine.test.ts` for the row identity.
 */

function ctx<I>(inputs: I): RunContext<I> {
  return { inputs, orgId: "org_test", executionId: "exec_test", nodeId: "node_test" };
}

type StoredNode = { id: string; type: string; position: { x: number; y: number }; data: { nodeType: string } };

function node(id: string, nodeType: string): StoredNode {
  return { id, type: "papaflow", position: { x: 0, y: 0 }, data: { nodeType } };
}

function edge(source: string, target: string, sourceHandle?: string) {
  return {
    id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ""}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

/** `t → loop`, with whatever the test wires around the loop. */
function graphOf(
  nodes: StoredNode[],
  edges: ReturnType<typeof edge>[],
): RunGraph {
  return toRunGraph({
    nodes: [node("t", "manual.trigger"), node("loop", "logic.loop"), ...nodes],
    edges: [edge("t", "loop"), ...edges],
    triggerId: "t",
  });
}

describe("logic.loop", () => {
  it("is a logic node with two handles, no credential and no feature gate", () => {
    expect(loopNode.type).toBe("logic.loop");
    expect(loopNode.name).toBe("For each item");
    expect(loopNode.category).toBe("logic");
    expect(loopNode.icon).toBe("Repeat");
    expect(loopNode.credential).toBeNull();
    expect(loopNode.requiresFeature).toBeNull();
    expect(loopNode.handles?.({ items: "[]" })).toEqual([EACH_HANDLE, DONE_HANDLE]);
    // Branching is the loop's own business: the workflow always continues down `done`.
    expect(loopNode.handle).toBeUndefined();
  });

  it("counts the items and leaves results for the workflow to fill in", async () => {
    const inputs = loopNode.inputs.parse({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    expect(await loopNode.run(ctx(inputs))).toEqual({ results: [], count: 3 });
  });

  it("hands the orchestrator the items themselves through `expand`", () => {
    const inputs = loopNode.inputs.parse({ items: ["a", "b"] });
    expect(loopNode.expand?.(inputs)).toEqual(["a", "b"]);
  });

  it("takes a template that resolved to a real array", () => {
    // What `resolveTemplates` does with `{{ http_request_1.body }}`: the raw value, not text.
    expect(loopItems([1, 2, 3])).toEqual([1, 2, 3]);
    expect(loopItems([])).toEqual([]);
    expect(loopNode.inputs.parse({ items: [{ a: 1 }] })).toEqual({ items: '[{"a":1}]' });
  });

  it("parses a JSON string, which is what an embedded template resolves to", () => {
    expect(loopItems('[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(loopItems("[]")).toEqual([]);
    expect(loopItems(" [1, 2] ")).toEqual([1, 2]);
  });

  it("refuses anything that is not a list with a 400, so the run stops instead of retrying", () => {
    for (const value of [7, null, undefined, true, { id: 1 }, "hello", '{"id":1}', ""]) {
      const thrown = (() => {
        try {
          loopItems(value);
          return null;
        } catch (error: unknown) {
          return error;
        }
      })();

      expect(thrown).toBeInstanceOf(ConnectorError);
      expect((thrown as ConnectorError).status).toBe(400);
      expect((thrown as Error).message).toMatch(/must resolve to an array/);
    }
  });

  it("turns an unconfigured Loop into that same sentence rather than a schema error", async () => {
    const inputs = loopNode.inputs.parse({});
    await expect(loopNode.run(ctx(inputs))).rejects.toThrow(/must resolve to an array/);
  });
});

describe("loopBody", () => {
  it("is the linear chain hanging off `each`", () => {
    const graph = graphOf(
      [node("a", "logic.set"), node("b", "http.request"), node("after", "email.send")],
      [
        edge("loop", "a", EACH_HANDLE),
        edge("a", "b"),
        edge("loop", "after", DONE_HANDLE),
      ],
    );

    expect(loopBody(graph, "loop")).toEqual(["a", "b"]);
  });

  it("stops at a node with nothing after it", () => {
    const graph = graphOf(
      [node("a", "logic.set")],
      [edge("loop", "a", EACH_HANDLE)],
    );

    expect(loopBody(graph, "loop")).toEqual(["a"]);
  });

  it("stops before anything the `done` side reaches, so a join runs once after the loop", () => {
    // each → a → email, done → email: the email is the "after the loop" node, not a body node.
    const graph = graphOf(
      [node("a", "logic.set"), node("email", "email.send"), node("last", "http.request")],
      [
        edge("loop", "a", EACH_HANDLE),
        edge("a", "email"),
        edge("loop", "email", DONE_HANDLE),
        edge("email", "last"),
      ],
    );

    expect(loopBody(graph, "loop")).toEqual(["a"]);
    expect(loopBodyNodes(graph)).toEqual(new Set(["a"]));
  });

  it("stops when the chain is wired back into the loop", () => {
    const graph = graphOf(
      [node("a", "logic.set"), node("b", "http.request")],
      [edge("loop", "a", EACH_HANDLE), edge("a", "b"), edge("b", "loop")],
    );

    expect(loopBody(graph, "loop")).toEqual(["a", "b"]);
  });

  it("cannot spin on a cycle inside the body", () => {
    const graph = graphOf(
      [node("a", "logic.set"), node("b", "http.request")],
      [edge("loop", "a", EACH_HANDLE), edge("a", "b"), edge("b", "a")],
    );

    expect(loopBody(graph, "loop")).toEqual(["a", "b"]);
  });

  it("is empty when nothing is wired to `each`", () => {
    const graph = graphOf(
      [node("after", "email.send")],
      [edge("loop", "after", DONE_HANDLE)],
    );

    expect(loopBody(graph, "loop")).toEqual([]);
    expect(loopBodyNodes(graph)).toEqual(new Set());
  });

  it("ignores a node wired to the loop's default output (there is no `out` handle)", () => {
    const graph = graphOf([node("a", "logic.set")], [edge("loop", "a")]);

    expect(loopBody(graph, "loop")).toEqual([]);
  });

  it("takes the first edge of a fork: one chain after `each` in v1", () => {
    const graph = graphOf(
      [node("a", "logic.condition"), node("yes", "logic.set"), node("no", "http.request")],
      [
        edge("loop", "a", EACH_HANDLE),
        edge("a", "yes", "true"),
        edge("a", "no", "false"),
      ],
    );

    expect(loopBody(graph, "loop")).toEqual(["a", "yes"]);
  });

  it("includes a nested Loop but does not walk through it: loops do not nest in v1", () => {
    const graph = graphOf(
      [node("inner", "logic.loop"), node("deep", "logic.set")],
      [edge("loop", "inner", EACH_HANDLE), edge("inner", "deep", EACH_HANDLE)],
    );

    expect(loopBody(graph, "loop")).toEqual(["inner"]);
    // The inner loop's own body still counts as a body: the walk must not run it either.
    expect(loopBodyNodes(graph)).toEqual(new Set(["inner", "deep"]));
  });
});

describe("loop bookkeeping", () => {
  const graph = graphOf(
    [node("a", "logic.set"), node("after", "email.send")],
    [edge("loop", "a", EACH_HANDLE), edge("loop", "after", DONE_HANDLE)],
  );

  it("recognises the loop nodes of a graph", () => {
    expect(isLoopNode(graph, "loop")).toBe(true);
    expect(isLoopNode(graph, "a")).toBe(false);
    expect(isLoopNode(graph, "missing")).toBe(false);
    expect(loopNodeIds(graph)).toEqual(["loop"]);
  });

  it("says which loop a node's body it is on — the picker's `$item` test", () => {
    expect(loopFor(graph, "a")).toBe("loop");
    expect(loopFor(graph, "after")).toBeNull();
    expect(loopFor(graph, "loop")).toBeNull();
  });

  it("gives every pass of a node its own hook token", () => {
    // Two suspended rows may never share a token: `steps.by_hookToken` is a unique lookup.
    expect(hookTokenFor("exec_1", "n1")).toBe("exec_1:n1");
    expect(hookTokenFor("exec_1", "n1", 0)).toBe("exec_1:n1:0");
    expect(hookTokenFor("exec_1", "n1", 2)).toBe("exec_1:n1:2");
    expect(hookTokenFor("exec_1", "n1", 0)).not.toBe(hookTokenFor("exec_1", "n1", 1));
  });
});
