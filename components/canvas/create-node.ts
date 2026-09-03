import { NODES } from "@/nodes/registry";

import { nextKey, PAPAFLOW_NODE_TYPE, type WorkflowNodeType } from "./graph-io";

/**
 * One palette entry, turned into a node on the canvas.
 *
 * There are two ways to get a node out of the palette and they have to produce exactly the same
 * thing: dragging a card onto the flow (`onDrop` in `Canvas`) and tapping one (the bottom sheet on
 * a phone, a click on the card anywhere else — a drag is not a gesture a finger can perform on a
 * list that also scrolls). So the "make a node" half lives here rather than inside the drop
 * handler, and both paths differ only in where the position comes from.
 *
 * `null` for a type the registry does not know: a stale drag payload, or a card from a build that
 * had a node this one does not. The caller leaves the graph alone.
 *
 * @param nodes    The graph as it stands. Read for the key only — nothing is mutated.
 * @param nodeType The registry type, e.g. `http.request`.
 * @param position Top-left of the new node, in flow coordinates.
 * @param id       The node id, for a test that wants a predictable one.
 */
export function createNodeFromPalette(
  nodes: readonly WorkflowNodeType[],
  nodeType: string,
  position: { x: number; y: number },
  id: string = crypto.randomUUID(),
): WorkflowNodeType | null {
  const definition = NODES[nodeType];
  if (!definition) return null;

  return {
    id,
    type: PAPAFLOW_NODE_TYPE,
    position: { x: position.x, y: position.y },
    data: {
      nodeType,
      // Assigned against the nodes as they are right now, so two quick adds of the same node type
      // get `http_request_1` and `http_request_2` rather than the same key twice.
      key: nextKey(nodes, nodeType),
      label: definition.name,
      // Empty on purpose: the config panel fills these in, and a node with nothing set is what the
      // "Needs setup" badge is for. A fresh object per node, never a shared one.
      inputs: {},
      status: "idle",
    },
  };
}

/**
 * Where a tapped node lands: the middle of what the user is looking at, less half a node, so the
 * card is centred on the viewport rather than starting at its centre point.
 *
 * The offsets are in flow units, which is what `screenToFlowPosition` already hands back — a node
 * is 240 CSS pixels wide at zoom 1 and stays 240 flow units wide at every zoom.
 *
 * @param centre The viewport's centre, in flow coordinates.
 */
export function centredNodePosition(centre: { x: number; y: number }): { x: number; y: number } {
  return { x: centre.x - 120, y: centre.y - 38 };
}
