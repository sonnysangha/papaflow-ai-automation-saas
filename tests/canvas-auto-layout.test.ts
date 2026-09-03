import { describe, expect, it } from "vitest";

import {
  autoLayout,
  canAutoLayout,
  DEFAULT_COLUMN_GAP,
  DEFAULT_ROW_GAP,
  type LayoutEdge,
  type LayoutNode,
} from "@/components/canvas/auto-layout";

/**
 * "Tidy up", as a pure function of a graph.
 *
 * Every case here is a graph shape someone actually draws — a chain, an If, a Loop, two branches
 * meeting again, a pile of overlapping nodes, an orphan — and the assertion is about what the
 * arrangement *says*: wires point right, the yes branch is above the no branch, a merge waits for
 * the longer path, and nothing sits on top of anything else.
 */

function node(id: string, nodeType = "logic.set", at = { x: 0, y: 0 }): LayoutNode {
  return { id, position: at, width: 240, height: 84, data: { nodeType, inputs: {} } };
}

function edge(source: string, target: string, sourceHandle?: string): LayoutEdge {
  return { source, target, ...(sourceHandle ? { sourceHandle } : {}) };
}

/** Do these two nodes' boxes touch, given the sizes the layout assumed? */
function overlaps(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width = 240,
  height = 84,
): boolean {
  return Math.abs(a.x - b.x) < width && Math.abs(a.y - b.y) < height;
}

describe("autoLayout", () => {
  it("lays a linear chain out on one row, left to right", () => {
    const nodes = [
      node("a", "manual.trigger", { x: 400, y: 90 }),
      node("b", "http.request", { x: 40, y: 620 }),
      node("c", "email.send", { x: 900, y: 10 }),
    ];
    const positions = autoLayout(nodes, [edge("a", "b"), edge("b", "c")]);

    expect(positions.a.y).toBe(positions.b.y);
    expect(positions.b.y).toBe(positions.c.y);
    expect(positions.b.x).toBeGreaterThan(positions.a.x);
    expect(positions.c.x).toBeGreaterThan(positions.b.x);
    // One column's width plus the gap, since every node here is 240 wide.
    expect(positions.b.x - positions.a.x).toBe(240 + DEFAULT_COLUMN_GAP);
  });

  it("fans an If node's yes branch above its no branch", () => {
    const nodes = [
      node("t", "manual.trigger"),
      node("if", "logic.condition"),
      node("yes", "email.send"),
      node("no", "email.send"),
    ];
    const positions = autoLayout(nodes, [
      edge("t", "if"),
      // Deliberately wired no-first, so the order can only come from the handles.
      edge("if", "no", "false"),
      edge("if", "yes", "true"),
    ]);

    expect(positions.yes.y).toBeLessThan(positions.no.y);
    expect(positions.yes.x).toBe(positions.no.x);
    // Symmetrical about the parent: half a row up, half a row down.
    expect(positions.if.y - positions.yes.y).toBe(DEFAULT_ROW_GAP / 2);
    expect(positions.no.y - positions.if.y).toBe(DEFAULT_ROW_GAP / 2);
  });

  it("puts a Loop's each-item chain above its when-done chain", () => {
    const nodes = [
      node("t", "manual.trigger"),
      node("loop", "logic.loop"),
      node("each", "slack.postMessage"),
      node("done", "email.send"),
    ];
    const positions = autoLayout(nodes, [
      edge("t", "loop"),
      edge("loop", "done", "done"),
      edge("loop", "each", "each"),
    ]);

    expect(positions.each.y).toBeLessThan(positions.done.y);
  });

  it("waits for the deeper branch before placing the node two branches merge into", () => {
    const nodes = [
      node("if", "logic.condition"),
      node("short", "logic.set"),
      node("long1", "logic.set"),
      node("long2", "logic.set"),
      node("merge", "email.send"),
    ];
    const positions = autoLayout(nodes, [
      edge("if", "short", "true"),
      edge("if", "long1", "false"),
      edge("long1", "long2"),
      edge("short", "merge"),
      edge("long2", "merge"),
    ]);

    // The long branch is two columns deep, so the merge sits in the column after it — never level
    // with, or behind, a node that feeds it.
    expect(positions.merge.x).toBeGreaterThan(positions.long2.x);
    expect(positions.merge.x).toBeGreaterThan(positions.short.x);
    expect(positions.long2.x).toBeGreaterThan(positions.short.x);
  });

  it("pulls a pile of nodes dropped on the same spot apart", () => {
    const nodes = [
      node("t", "manual.trigger", { x: 120, y: 120 }),
      node("if", "logic.condition", { x: 122, y: 118 }),
      node("yes", "email.send", { x: 125, y: 121 }),
      node("no", "email.send", { x: 118, y: 124 }),
    ];
    const positions = autoLayout(nodes, [
      edge("t", "if"),
      edge("if", "yes", "true"),
      edge("if", "no", "false"),
    ]);

    const placed = Object.values(positions);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(overlaps(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it("keeps two children of the same handle a whole row apart", () => {
    const nodes = [node("t", "manual.trigger"), node("a"), node("b")];
    const positions = autoLayout(nodes, [edge("t", "a"), edge("t", "b")]);

    expect(Math.abs(positions.a.y - positions.b.y)).toBeGreaterThanOrEqual(DEFAULT_ROW_GAP);
  });

  it("terminates on a cycle instead of hanging the editor", () => {
    const nodes = [node("t", "manual.trigger"), node("a"), node("b"), node("c")];
    const positions = autoLayout(nodes, [
      edge("t", "a"),
      edge("a", "b"),
      edge("b", "c"),
      // …and back round.
      edge("c", "a"),
    ]);

    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c", "t"]);
    for (const at of Object.values(positions)) {
      expect(Number.isFinite(at.x)).toBe(true);
      expect(Number.isFinite(at.y)).toBe(true);
    }
  });

  it("gives an orphan a row of its own under the graph it is not part of", () => {
    const nodes = [
      node("t", "manual.trigger"),
      node("a"),
      node("b"),
      // Nothing points at it and it points at nothing — dragged in and never wired up.
      node("orphan", "slack.postMessage", { x: 0, y: -900 }),
    ];
    const positions = autoLayout(nodes, [edge("t", "a"), edge("a", "b")]);

    for (const id of ["t", "a", "b"]) {
      expect(positions.orphan.y).toBeGreaterThan(positions[id].y);
    }
    // Its own block, so it starts back at the left rather than trailing the chain.
    expect(positions.orphan.x).toBe(positions.t.x);
  });

  it("puts the trigger's block above an orphan's however they are ordered now", () => {
    const nodes = [
      node("orphan", "slack.postMessage", { x: 0, y: -500 }),
      node("t", "manual.trigger", { x: 0, y: 400 }),
      node("a"),
    ];
    const positions = autoLayout(nodes, [edge("t", "a")]);

    expect(positions.t.y).toBeLessThan(positions.orphan.y);
  });

  it("lands on the graph's own top-left corner rather than the origin", () => {
    const nodes = [
      node("t", "manual.trigger", { x: 640, y: 320 }),
      node("a", "logic.set", { x: 980, y: 500 }),
    ];
    const positions = autoLayout(nodes, [edge("t", "a")]);

    expect(Math.min(positions.t.x, positions.a.x)).toBe(640);
    expect(Math.min(positions.t.y, positions.a.y)).toBe(320);
  });

  it("respects measured sizes over stored ones when spacing columns and rows", () => {
    const wide: LayoutNode = {
      id: "wide",
      position: { x: 0, y: 0 },
      width: 240,
      height: 84,
      measured: { width: 400, height: 300 },
      data: { nodeType: "manual.trigger", inputs: {} },
    };
    const positions = autoLayout([wide, node("a"), node("b")], [
      edge("wide", "a"),
      edge("wide", "b"),
    ]);

    expect(positions.a.x - positions.wide.x).toBe(400 + DEFAULT_COLUMN_GAP);
  });

  it("honours custom gaps", () => {
    const positions = autoLayout([node("t", "manual.trigger"), node("a")], [edge("t", "a")], {
      columnGap: 10,
      rowGap: 20,
    });
    expect(positions.a.x - positions.t.x).toBe(250);
  });

  it("returns one position per node, mutating nothing", () => {
    const nodes = [node("t", "manual.trigger", { x: 5, y: 6 }), node("a", "logic.set", { x: 7, y: 8 })];
    const edges = [edge("t", "a")];
    const snapshot = JSON.stringify({ nodes, edges });

    const positions = autoLayout(nodes, edges);

    expect(Object.keys(positions).sort()).toEqual(["a", "t"]);
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot);
  });

  it("has nothing to say about an empty or single-node canvas", () => {
    expect(autoLayout([], [])).toEqual({});
    expect(canAutoLayout([])).toBe(false);
    expect(canAutoLayout([{ id: "a" }])).toBe(false);
    expect(canAutoLayout([{ id: "a" }, { id: "b" }])).toBe(true);
  });

  it("ignores an edge pointing at a node that is not on the canvas", () => {
    const positions = autoLayout([node("t", "manual.trigger"), node("a")], [
      edge("t", "a"),
      edge("a", "ghost"),
      edge("ghost", "t"),
    ]);
    expect(positions.a.x).toBeGreaterThan(positions.t.x);
  });
});
