import { describe, expect, it } from "vitest";

import { centredNodePosition, createNodeFromPalette } from "@/components/canvas/create-node";
import { PAPAFLOW_NODE_TYPE, type WorkflowNodeType } from "@/components/canvas/graph-io";
import { NODES } from "@/nodes/registry";

/**
 * The one place a palette entry becomes a node.
 *
 * Two gestures reach it — dragging a card onto the flow and tapping one, the latter being the only
 * way to add a node at all on a phone — and they must produce the same node, so the part that makes
 * it is a function rather than something living inside the drop handler.
 */

/** A node as it would already be on the canvas, for the key arithmetic to run against. */
function existing(nodeType: string, key: string): WorkflowNodeType {
  return {
    id: `id-${key}`,
    type: PAPAFLOW_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { nodeType, key, label: "whatever", inputs: {}, status: "idle" },
  };
}

describe("createNodeFromPalette", () => {
  it("puts the node exactly where it was asked for", () => {
    const node = createNodeFromPalette([], "http.request", { x: 412.5, y: -80 }, "a");
    expect(node?.position).toEqual({ x: 412.5, y: -80 });
    expect(node?.type).toBe(PAPAFLOW_NODE_TYPE);
    expect(node?.id).toBe("a");
  });

  it("takes its name and label from the registry", () => {
    const node = createNodeFromPalette([], "http.request", { x: 0, y: 0 }, "a");
    expect(node?.data.nodeType).toBe("http.request");
    expect(node?.data.label).toBe(NODES["http.request"].name);
    expect(node?.data.status).toBe("idle");
  });

  it("starts with no configuration, and a fresh object each time", () => {
    const first = createNodeFromPalette([], "http.request", { x: 0, y: 0 }, "a");
    const second = createNodeFromPalette([], "http.request", { x: 0, y: 0 }, "b");
    expect(first?.data.inputs).toEqual({});
    // Not the same object: writing a field on one node must not configure every other node of that
    // type on the canvas.
    expect(first?.data.inputs).not.toBe(second?.data.inputs);
  });

  it("gives each node the smallest free key for its type", () => {
    const empty = createNodeFromPalette([], "http.request", { x: 0, y: 0 }, "a");
    expect(empty?.data.key).toBe("http_request_1");

    const nodes = [existing("http.request", "http_request_1")];
    const second = createNodeFromPalette(nodes, "http.request", { x: 0, y: 0 }, "b");
    expect(second?.data.key).toBe("http_request_2");
  });

  it("keeps two quick adds apart, because each is keyed against the graph it lands in", () => {
    let nodes: WorkflowNodeType[] = [];
    const keys: string[] = [];
    for (const id of ["a", "b", "c"]) {
      const node = createNodeFromPalette(nodes, "http.request", { x: 0, y: 0 }, id);
      if (!node) throw new Error("expected a node");
      nodes = nodes.concat(node);
      keys.push(node.data.key);
    }
    expect(keys).toEqual(["http_request_1", "http_request_2", "http_request_3"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("reuses a freed number rather than climbing forever", () => {
    const nodes = [existing("http.request", "http_request_2")];
    expect(createNodeFromPalette(nodes, "http.request", { x: 0, y: 0 }, "a")?.data.key).toBe(
      "http_request_1",
    );
  });

  it("counts only nodes of the same type", () => {
    const nodes = [existing("manual.trigger", "manual_trigger_1")];
    expect(createNodeFromPalette(nodes, "http.request", { x: 0, y: 0 }, "a")?.data.key).toBe(
      "http_request_1",
    );
  });

  it("refuses a type the registry does not know, so a stale drag leaves the graph alone", () => {
    expect(createNodeFromPalette([], "not.a.node", { x: 0, y: 0 }, "a")).toBeNull();
    expect(createNodeFromPalette([], "", { x: 0, y: 0 }, "a")).toBeNull();
  });

  it("makes an id of its own when none is given", () => {
    const first = createNodeFromPalette([], "http.request", { x: 0, y: 0 });
    const second = createNodeFromPalette([], "http.request", { x: 0, y: 0 });
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });
});

describe("centredNodePosition", () => {
  it("offsets by half a node, so the card is centred on the point rather than starting at it", () => {
    // A node is 240 wide and about 76 tall at zoom 1, and flow units do not change with zoom.
    expect(centredNodePosition({ x: 1000, y: 500 })).toEqual({ x: 880, y: 462 });
  });
});
