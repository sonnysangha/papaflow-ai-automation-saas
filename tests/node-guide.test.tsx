import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { conditionPreview } from "@/components/canvas/condition-preview";
import { handleDisplays, handleLabel, sourceHandles } from "@/components/canvas/graph-io";
import type { LastRunStep } from "@/components/canvas/last-run";
import { NodeGuide } from "@/components/canvas/NodeGuide";
import { NODES } from "@/nodes/registry";

/**
 * The plain-language layer: the words a Logic node is explained and drawn in, sitting on top of ids
 * that can never change because saved graphs carry them. Everything here is about keeping the two
 * in step — a `guide.outputs` entry for a handle the node does not have would label nothing, and a
 * renamed handle would silently fall back to its id on the canvas.
 */

/** Every node the sidebar files under Logic. */
const LOGIC_NODES = Object.values(NODES).filter((node) => node.category === "logic");

function step(input: unknown, output: unknown): LastRunStep {
  return { status: "success", input, output, startedAt: 0, finishedAt: 1, durationMs: 1 };
}

describe("logic node guides", () => {
  it("explains every Logic node", () => {
    expect(LOGIC_NODES).toHaveLength(7);
    for (const node of LOGIC_NODES) {
      // Long enough to be a paragraph rather than a restated title.
      expect(node.guide?.summary.length ?? 0).toBeGreaterThan(80);
    }
  });

  it("only names handles the node actually has", () => {
    for (const node of LOGIC_NODES) {
      const named = Object.keys(node.guide?.outputs ?? {});
      if (named.length === 0) continue;
      // The default configuration, which is what a node dropped on the canvas runs with.
      const handles = sourceHandles(node.type, {});
      for (const handle of named) expect(handles).toContain(handle);
    }
  });

  it("keeps the ids saved graphs address the branches by", () => {
    expect(sourceHandles("logic.condition", {})).toEqual(["true", "false"]);
    expect(sourceHandles("logic.loop", {})).toEqual(["each", "done"]);
    expect(sourceHandles("logic.approval", {})).toEqual(["approved", "rejected"]);
    expect(sourceHandles("logic.switch", {})).toEqual(["default"]);
  });
});

describe("handleLabel", () => {
  it("shows a branch under the words the node chose for it", () => {
    expect(handleLabel("logic.condition", "true")).toBe("yes");
    expect(handleLabel("logic.condition", "false")).toBe("no");
    expect(handleLabel("logic.loop", "each")).toBe("each item");
    expect(handleLabel("logic.loop", "done")).toBe("when done");
    expect(handleLabel("logic.switch", "default")).toBe("otherwise");
  });

  it("shows a handle the node did not name as itself — which is what a Switch case wants", () => {
    // The handle id *is* the case the user typed, so there is nothing to translate.
    expect(handleLabel("logic.switch", "gold")).toBe("gold");
    expect(handleLabel("logic.approval", "approved")).toBe("approved");
    expect(handleLabel("http.request", "out")).toBe("out");
  });

  it("falls back to the id for a node type that is not installed", () => {
    expect(handleLabel("nope.missing", "true")).toBe("true");
  });
});

describe("handleDisplays", () => {
  it("pairs each handle with its words, in the order the node draws them", () => {
    expect(handleDisplays("logic.condition", {})).toEqual([
      { handle: "true", label: "yes" },
      { handle: "false", label: "no" },
    ]);
    expect(handleDisplays("logic.loop", { items: "[]" })).toEqual([
      { handle: "each", label: "each item" },
      { handle: "done", label: "when done" },
    ]);
  });

  it("labels a Switch's cases by name and its fallthrough as otherwise", () => {
    expect(handleDisplays("logic.switch", { value: "", cases: ["gold", "silver"] })).toEqual([
      { handle: "gold", label: "gold" },
      { handle: "silver", label: "silver" },
      { handle: "default", label: "otherwise" },
    ]);
  });
});

describe("conditionPreview", () => {
  it("reads the last comparison back as a sentence", () => {
    const preview = conditionPreview(
      step({ left: "12", operator: "greaterThan", right: "10" }, { result: true, left: 12, right: 10 }),
    );
    expect(preview).toEqual({ left: "12", operator: "is greater than", right: "10", result: true });
  });

  it("prefers the values the comparison used over the ones the form holds", () => {
    // The input is what `runNode` resolved; the output is what `run` compared. Both are resolved,
    // but the output is the last word — and it is the half that survives an older input shape.
    const preview = conditionPreview(
      step({ left: "gold", operator: "equals", right: "silver" }, { result: false, left: "gold", right: "silver" }),
    );
    expect(preview).toEqual({ left: "gold", operator: "is equal to", right: "silver", result: false });
  });

  it("drops the right-hand side for a comparison that ignores it", () => {
    expect(conditionPreview(step({ left: "", operator: "isEmpty" }, { result: true, left: "" }))).toEqual({
      left: '""',
      operator: "is empty",
      right: null,
      result: true,
    });
  });

  it("defaults to the node's own operator when the field was never set", () => {
    expect(conditionPreview(step({ left: "a", right: "a" }, { result: true, left: "a", right: "a" }))?.operator).toBe(
      "is equal to",
    );
  });

  it("says nothing when there is nothing honest to say", () => {
    expect(conditionPreview(null)).toBeNull();
    // A run still going, or one that failed before it compared anything.
    expect(conditionPreview({ status: "running", input: { left: "a" }, startedAt: 0 })).toBeNull();
    expect(conditionPreview(step({ left: "a" }, { error: "boom" }))).toBeNull();
  });

  it("shortens a long value rather than filling the panel with it", () => {
    const long = "x".repeat(200);
    expect(conditionPreview(step({ operator: "contains" }, { result: true, left: long, right: "x" }))?.left).toMatch(
      /…$/,
    );
  });
});

describe("the NodeGuide card", () => {
  const render = (type: string, inputs: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <NodeGuide guide={NODES[type].guide!} handles={handleDisplays(type, inputs)} />,
    );

  it("explains the node and draws its ways out in the same words the canvas uses", () => {
    const html = render("logic.condition");
    expect(html).toContain("How this node works");
    expect(html).toContain("Ways out:");
    expect(html).toContain(">yes<");
    expect(html).toContain(">no<");
    // The id belongs on hover, not on the screen: it is the word the plain one replaced.
    expect(html).not.toContain(">true<");
    expect(html).toContain("saved as true");
  });

  it("draws a Switch's cases beside its otherwise", () => {
    const html = render("logic.switch", { value: "", cases: ["gold"] });
    expect(html).toContain(">gold<");
    expect(html).toContain(">otherwise<");
  });

  it("leaves out the diagram for a node with one way out", () => {
    const html = render("logic.set");
    expect(html).toContain("How this node works");
    expect(html).not.toContain("Ways out:");
  });
});
