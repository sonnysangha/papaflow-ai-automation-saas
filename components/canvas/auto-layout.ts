// "Tidy up": every node spaced out on a grid that follows the graph, so a canvas somebody dragged
// into a pile — or one a Builder agent dropped nodes onto — reads left to right again.
//
// Pure, dependency-free and synchronous. A workflow graph is tens of nodes, so a layered
// (Sugiyama-ish) pass over it costs nothing; pulling in dagre or elk to do the same thing would be
// a bundle and a build step for a button. It never mutates its inputs: it hands back new positions
// keyed by node id, which the canvas applies through the same `setNodes` a drag goes through, so
// tidying is one ordinary undo step.

import { sourceHandles } from "./graph-io";
import { NODES } from "@/nodes/registry";

/** The default node width, matching `MIN_NODE_WIDTH`, for a node React Flow has not measured yet. */
const DEFAULT_WIDTH = 240;
/** …and its height, which decides how far the next node in a column has to be pushed down. */
const DEFAULT_HEIGHT = 84;
/** Clear air under a node before the next one in the same column may start. */
const NODE_CLEARANCE = 40;

export const DEFAULT_COLUMN_GAP = 80;
export const DEFAULT_ROW_GAP = 150;

/** What the layout reads off a canvas node. `WorkflowNodeType` satisfies it. */
export type LayoutNode = {
  id: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  /** What React Flow measured once the node was on screen; preferred over the stored size. */
  measured?: { width?: number; height?: number };
  data: { nodeType: string; inputs: Record<string, unknown> };
};

export type LayoutEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export type AutoLayoutOptions = {
  /** Horizontal air between two columns. */
  columnGap?: number;
  /** The smallest vertical step between two nodes in the same column, and one branch's fan-out. */
  rowGap?: number;
  /** Left-to-right for now. The graph reads that way everywhere else in the editor. */
  direction?: "LR";
};

export type LayoutPositions = Record<string, { x: number; y: number }>;

function widthOf(node: LayoutNode): number {
  return node.measured?.width ?? node.width ?? DEFAULT_WIDTH;
}

function heightOf(node: LayoutNode): number {
  return node.measured?.height ?? node.height ?? DEFAULT_HEIGHT;
}

/** The single source handle of a node that does not branch; edges leave it with no `sourceHandle`. */
const DEFAULT_HANDLE = "out";

/**
 * Where every node should sit, left to right, given the wires between them.
 *
 * The shape of it:
 *
 * - **Roots** are the nodes nothing points at — the trigger first, then any orphans, each keeping
 *   the top-to-bottom order it already had. Every root starts its own block, and the blocks are
 *   stacked, so an orphaned node ends up on a row of its own under the graph it is not part of
 *   rather than tangled through it.
 * - **Columns** are the longest path from a root, so a node reached by both a short branch and a
 *   long one sits after the long one and its wires never point backwards. A cycle — which the
 *   canvas allows you to draw — is relaxed a bounded number of times and then left where it is,
 *   because a button that hangs the editor is worse than a graph that stays untidy.
 * - **Rows** follow the parent. A node's wanted y is its first parent's y, shifted by which way out
 *   of that parent it hangs off: `(handleIndex − (handleCount − 1) / 2) × rowGap`. A linear chain
 *   is therefore dead straight, an If fans `true` above `false` symmetrically, and a Loop's `each`
 *   sits above its `done`. Where two nodes want the same row, the column is sorted by what they
 *   wanted and each is pushed just far enough below the one before it.
 *
 * The finished block is translated so its top-left corner lands on the current graph's top-left
 * corner: the nodes rearrange, the viewport does not have to go looking for them.
 */
export function autoLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: AutoLayoutOptions = {},
): LayoutPositions {
  const columnGap = options.columnGap ?? DEFAULT_COLUMN_GAP;
  const rowGap = options.rowGap ?? DEFAULT_ROW_GAP;
  if (nodes.length === 0) return {};

  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Edges that join two nodes actually on the canvas; anything else is not a wire.
  const wires = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));

  const outgoing = new Map<string, LayoutEdge[]>();
  const parents = new Map<string, LayoutEdge[]>();
  for (const edge of wires) {
    push(outgoing, edge.source, edge);
    push(parents, edge.target, edge);
  }

  // --- roots ---------------------------------------------------------------------------------
  const roots = nodes
    .filter((node) => (parents.get(node.id)?.length ?? 0) === 0)
    .sort((a, b) => {
      const trigger = Number(isTrigger(b)) - Number(isTrigger(a));
      return trigger !== 0 ? trigger : a.position.y - b.position.y || a.position.x - b.position.x;
    });

  // --- columns: the longest path from any root ------------------------------------------------
  const column = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    column.set(root.id, 0);
    queue.push(root.id);
  }
  // A node may be pushed right at most once per other node — enough for any acyclic graph, and the
  // bound that stops a cycle from relaxing forever.
  const bumps = new Map<string, number>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const next = (column.get(id) ?? 0) + 1;
    for (const edge of outgoing.get(id) ?? []) {
      if ((column.get(edge.target) ?? -1) >= next) continue;
      const seen = (bumps.get(edge.target) ?? 0) + 1;
      if (seen > nodes.length) continue;
      bumps.set(edge.target, seen);
      column.set(edge.target, next);
      queue.push(edge.target);
    }
  }
  // Nodes only a cycle can reach have no root and so no column yet. Column 0 keeps them on screen.
  for (const node of nodes) if (!column.has(node.id)) column.set(node.id, 0);

  // --- order within each column ----------------------------------------------------------------
  // Roots first, in the order decided above; then, column by column, children sorted by their
  // parent's place, by which way out of that parent they hang, and finally by where they are now.
  const order = new Map<string, number>();
  roots.forEach((root, index) => order.set(root.id, index));

  const columns = new Map<number, LayoutNode[]>();
  for (const node of nodes) push(columns, column.get(node.id) ?? 0, node);
  const columnIndexes = [...columns.keys()].sort((a, b) => a - b);

  /** The parent a node hangs off: the one that comes first in the layout, with its handle. */
  const primary = new Map<string, { parent: LayoutNode; handleIndex: number; handleCount: number }>();

  for (const index of columnIndexes) {
    const members = columns.get(index) as LayoutNode[];
    for (const node of members) {
      const incoming = parents.get(node.id) ?? [];
      let best: { edge: LayoutEdge; parent: LayoutNode; rank: number } | null = null;
      for (const edge of incoming) {
        const parent = byId.get(edge.source);
        if (!parent) continue;
        // Earliest in reading order wins: column first, then place within that column.
        const rank = (column.get(parent.id) ?? 0) * 1e6 + (order.get(parent.id) ?? 1e5);
        if (best === null || rank < best.rank) best = { edge, parent, rank };
      }
      if (!best) continue;
      const handles = sourceHandles(best.parent.data.nodeType, best.parent.data.inputs);
      const handle = best.edge.sourceHandle ?? DEFAULT_HANDLE;
      const at = handles.indexOf(handle);
      primary.set(node.id, {
        parent: best.parent,
        handleIndex: at === -1 ? 0 : at,
        handleCount: handles.length,
      });
    }

    if (index === 0) {
      // Column 0 is the roots, already ordered — plus anything a cycle stranded here.
      members.sort((a, b) => sortKey(a, b, order));
    } else {
      members.sort((a, b) => {
        const left = primary.get(a.id);
        const right = primary.get(b.id);
        const byParent =
          (order.get(left?.parent.id ?? "") ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right?.parent.id ?? "") ?? Number.MAX_SAFE_INTEGER);
        if (byParent !== 0) return byParent;
        const byHandle = (left?.handleIndex ?? 0) - (right?.handleIndex ?? 0);
        if (byHandle !== 0) return byHandle;
        return a.position.y - b.position.y;
      });
    }
    members.forEach((node, at) => order.set(node.id, at));
  }

  // --- which root each node belongs to, so orphans get their own block -------------------------
  const block = new Map<string, number>();
  roots.forEach((root, index) => block.set(root.id, index));
  for (const index of columnIndexes) {
    for (const node of columns.get(index) as LayoutNode[]) {
      if (block.has(node.id)) continue;
      const parent = primary.get(node.id)?.parent.id;
      block.set(node.id, (parent === undefined ? undefined : block.get(parent)) ?? 0);
    }
  }

  // --- x: one running sum over the widest node in each column ----------------------------------
  const xOf = new Map<number, number>();
  let x = 0;
  for (const index of columnIndexes) {
    xOf.set(index, x);
    const widest = Math.max(...(columns.get(index) as LayoutNode[]).map(widthOf));
    x += widest + columnGap;
  }

  // --- y: wanted rows first, then pushed apart, one root block at a time -----------------------
  //
  // Each block is laid out around zero — a branch is free to fan *above* its parent — and only then
  // dropped under whatever was placed before it. Clamping to the block's top while laying it out
  // would flatten the first fan-out against the ceiling, which is the one thing this is for.
  const y = new Map<string, number>();
  let stackTop = 0;

  for (let blockIndex = 0; blockIndex < Math.max(roots.length, 1); blockIndex += 1) {
    const local = new Map<string, number>();
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const index of columnIndexes) {
      const members = (columns.get(index) as LayoutNode[]).filter(
        (node) => block.get(node.id) === blockIndex,
      );
      if (members.length === 0) continue;

      const wanted = members.map((node) => {
        const from = primary.get(node.id);
        const parentY = from === undefined ? undefined : local.get(from.parent.id);
        // A root, or a node whose parent this block does not hold: it starts the block's own row.
        if (from === undefined || parentY === undefined) return { node, at: 0 };
        // Symmetrical about the parent: a single way out adds nothing, two fan ±½ a row, three
        // fan −1, 0, +1, and so on.
        const spread = (from.handleIndex - (from.handleCount - 1) / 2) * rowGap;
        return { node, at: parentY + spread };
      });

      // A wanted row is only a wish: two children of different parents can want the same one.
      wanted.sort((a, b) => a.at - b.at || (order.get(a.node.id) ?? 0) - (order.get(b.node.id) ?? 0));

      let previous: { y: number; height: number } | null = null;
      for (const { node, at } of wanted) {
        // A row of its own: `rowGap` apart, or clear of the node above when that one is taller.
        const placed: number =
          previous === null
            ? at
            : Math.max(at, previous.y + Math.max(rowGap, previous.height + NODE_CLEARANCE));
        const height = heightOf(node);
        local.set(node.id, placed);
        previous = { y: placed, height };
        top = Math.min(top, placed);
        bottom = Math.max(bottom, placed + height);
      }
    }

    if (local.size === 0) continue;
    const shift = stackTop - top;
    for (const [id, at] of local) y.set(id, at + shift);
    stackTop = bottom + shift + rowGap;
  }

  // Anything the blocks somehow missed (a stranded cycle with no root of its own) still needs a row.
  for (const node of nodes) {
    if (y.has(node.id)) continue;
    y.set(node.id, stackTop);
    stackTop += rowGap;
  }

  // --- translate the whole thing back onto the graph's own top-left ----------------------------
  const laid = nodes.map((node) => ({
    id: node.id,
    x: xOf.get(column.get(node.id) ?? 0) ?? 0,
    y: y.get(node.id) ?? 0,
  }));
  const dx = Math.min(...nodes.map((node) => node.position.x)) - Math.min(...laid.map((n) => n.x));
  const dy = Math.min(...nodes.map((node) => node.position.y)) - Math.min(...laid.map((n) => n.y));

  const positions: LayoutPositions = {};
  for (const node of laid) positions[node.id] = { x: node.x + dx, y: node.y + dy };
  return positions;
}

/** `map.get(key).push(value)`, creating the list the first time. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function isTrigger(node: LayoutNode): boolean {
  return NODES[node.data.nodeType]?.category === "trigger";
}

/** Column 0's fallback order: whatever the roots were given, then top to bottom. */
function sortKey(a: LayoutNode, b: LayoutNode, order: Map<string, number>): number {
  const byOrder =
    (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  return byOrder !== 0 ? byOrder : a.position.y - b.position.y;
}

/**
 * Is this graph worth tidying? Fewer than two nodes has no arrangement, and the button says so by
 * being disabled rather than by doing nothing when pressed.
 */
export function canAutoLayout(nodes: readonly { id: string }[]): boolean {
  return nodes.length > 1;
}
