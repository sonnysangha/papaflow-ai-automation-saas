// Translation between the React Flow state the canvas edits and the JSON Convex stores on
// `workflows.graph`. Nothing in here touches React so the shape stays easy to reason about
// (and to reuse from the Builder agent in Phase 12).
import type { Edge, Node, Viewport } from "@xyflow/react";

import { NODES } from "@/nodes/registry";

/** The only React Flow node type this canvas renders; stored on every node as `type`. */
export const PAPAFLOW_NODE_TYPE = "papaflow";

/** Drag payload: the sidebar writes a node `type` here, the canvas reads it on drop. */
export const NODE_DRAG_MIME = "application/papaflow-node";

/** The single source handle of a node that does not branch; edges leave it with no `sourceHandle`. */
export const DEFAULT_HANDLE = "out";

/**
 * Runtime-only; fed from the `steps` table. Never stored. Every `steps.status` value plus `idle`
 * for a node the latest run has no row for, so a step status assigns straight into node data.
 */
export type NodeStatus = "idle" | "running" | "success" | "failed" | "waiting" | "skipped";

/**
 * What the latest run knows about one node, keyed by node id in `Editor`. `handle` is the branch
 * a Condition/Switch actually took (the canvas dims the others) and `output` is what the step
 * returned, which the variable picker mines for paths the output schema cannot describe.
 */
export type RunNodeState = {
  status: NodeStatus;
  handle?: string;
  output?: unknown;
};

/** The shape a node key must have to be usable in a template: `{{ http_request_1.body }}`. */
export const NODE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export type WorkflowNodeData = {
  /** Key into `NODES`, e.g. `http.request`. */
  nodeType: string;
  /** Stable human name templates address this node by; unique per workflow. */
  key: string;
  label: string;
  inputs: Record<string, unknown>;
  status?: NodeStatus;
};

/** What actually reaches Convex — `status` is stripped on the way out. */
export type StoredNodeData = Omit<WorkflowNodeData, "status">;

export type WorkflowNodeType = Node<WorkflowNodeData, typeof PAPAFLOW_NODE_TYPE>;

export type StoredNode = {
  id: string;
  type: typeof PAPAFLOW_NODE_TYPE;
  position: { x: number; y: number };
  data: StoredNodeData;
};

export type StoredEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

export type StoredGraph = {
  nodes: StoredNode[];
  edges: StoredEdge[];
  viewport?: Viewport;
  triggerId?: string;
};

/** The graph as it comes back from Convex, where nodes and edges are `v.any()`. */
export type StoredGraphInput = {
  nodes?: unknown[];
  edges?: unknown[];
  viewport?: unknown;
  triggerId?: unknown;
};

export type LoadedGraph = {
  nodes: WorkflowNodeType[];
  edges: Edge[];
  viewport?: Viewport;
};

/** What the editor shows while a debounced save is in flight. */
export type SaveState = "saved" | "saving" | "conflict" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toNode(raw: unknown): WorkflowNodeType | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;

  const data = isRecord(raw.data) ? raw.data : {};
  const nodeType = typeof data.nodeType === "string" ? data.nodeType : "";
  if (nodeType.length === 0) return null;

  const position = isRecord(raw.position) ? raw.position : {};

  return {
    id: raw.id,
    type: PAPAFLOW_NODE_TYPE,
    position: { x: toFinite(position.x, 0), y: toFinite(position.y, 0) },
    data: {
      nodeType,
      // Empty for a graph saved before Phase 3; `migrateKeys` fills it in on load.
      key: toOptionalString(data.key) ?? "",
      label: toOptionalString(data.label) ?? NODES[nodeType]?.name ?? nodeType,
      inputs: isRecord(data.inputs) ? data.inputs : {},
      status: "idle",
    },
  };
}

/** `http.request` → `http_request`, kept inside `NODE_KEY_PATTERN` for exotic node types. */
function keyPrefix(nodeType: string): string {
  const base = nodeType.replaceAll(".", "_").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return NODE_KEY_PATTERN.test(base) ? base : `n_${base}`;
}

function nextKeyFrom(taken: ReadonlySet<string>, nodeType: string): string {
  const prefix = keyPrefix(nodeType);
  for (let n = 1; ; n++) {
    const key = `${prefix}_${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * The key a newly dropped node gets: `<nodeType with '.' → '_'>_<n>` with the smallest free
 * `n ≥ 1`, so deleting `http_request_1` and dropping another HTTP node reuses the name rather
 * than climbing forever.
 */
export function nextKey(nodes: readonly WorkflowNodeType[], nodeType: string): string {
  return nextKeyFrom(new Set(nodes.map((node) => node.data.key)), nodeType);
}

/**
 * The key `workflows/graph.ts#keyFor` derives for a node that has none: its type and its position
 * in the stored array, not the smallest free number. The rule is duplicated rather than imported
 * because `workflows/` is `"use step"` code, and the two have to agree — a legacy graph that has
 * already run must migrate to the very keys its run outputs were stored under, `_2` collision
 * suffix included.
 */
function derivedKey(taken: ReadonlySet<string>, nodeType: string, index: number): string {
  const derived = `${keyPrefix(nodeType)}_${index + 1}`;
  if (!taken.has(derived)) return derived;
  let suffix = 2;
  while (taken.has(`${derived}_${suffix}`)) suffix++;
  return `${derived}_${suffix}`;
}

/**
 * Gives every node a key: graphs saved before Phase 3 have none, and a hand-edited or
 * agent-written graph may repeat one. A usable key is kept (the first node wins a duplicate) and
 * everything else is numbered by position — exactly what the engine derives for a keyless graph,
 * so a workflow that ran before this migration keeps the names its run outputs already used.
 */
export function migrateKeys(nodes: readonly WorkflowNodeType[]): WorkflowNodeType[] {
  const taken = new Set<string>();
  return nodes.map((node, index) => {
    if (NODE_KEY_PATTERN.test(node.data.key) && !taken.has(node.data.key)) {
      taken.add(node.data.key);
      return node;
    }
    const key = derivedKey(taken, node.data.nodeType, index);
    taken.add(key);
    return { ...node, data: { ...node.data, key } };
  });
}

/**
 * The source handles a node shows on the canvas, and the branches its panel lists. `handles()` is
 * user code reading a half-finished config — a Switch dropped a second ago has no `cases` array
 * yet — so the stored inputs go through the node's own schema first (which supplies the defaults)
 * and a definition that throws anyway falls back to the single default handle rather than
 * taking the canvas down with it.
 */
export function sourceHandles(nodeType: string, inputs: Record<string, unknown>): string[] {
  const definition = NODES[nodeType];
  if (!definition?.handles) return [DEFAULT_HANDLE];
  const parsed = definition.inputs.safeParse(inputs);
  try {
    const handles = definition.handles(parsed.success ? parsed.data : inputs);
    return handles.length > 0 ? handles : [DEFAULT_HANDLE];
  } catch {
    return [DEFAULT_HANDLE];
  }
}

/**
 * Every node that can reach `nodeId`, nearest first — the nodes whose outputs are in scope for a
 * template. Walks the edges backwards; a cycle the canvas allowed cannot loop it.
 */
export function upstreamNodeIds(edges: readonly Edge[], nodeId: string): string[] {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target);
    if (sources) sources.push(edge.source);
    else incoming.set(edge.target, [edge.source]);
  }

  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  const upstream: string[] = [];
  for (let index = 0; index < queue.length; index++) {
    for (const source of incoming.get(queue[index]) ?? []) {
      if (seen.has(source)) continue;
      seen.add(source);
      upstream.push(source);
      queue.push(source);
    }
  }
  return upstream;
}

function toEdge(raw: unknown): Edge | null {
  if (!isRecord(raw)) return null;
  const { id, source, target } = raw;
  if (typeof id !== "string" || typeof source !== "string" || typeof target !== "string") return null;

  return {
    id,
    source,
    target,
    sourceHandle: toOptionalString(raw.sourceHandle) ?? null,
    targetHandle: toOptionalString(raw.targetHandle) ?? null,
  };
}

function toViewport(raw: unknown): Viewport | undefined {
  if (!isRecord(raw)) return undefined;
  const { x, y, zoom } = raw;
  if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return undefined;
  return { x, y, zoom };
}

/**
 * Stored graph → canvas state. Anything unrecognised is dropped rather than crashing the
 * editor: edges pointing at missing nodes, nodes without a `nodeType`, duplicate edge ids.
 */
export function fromStoredGraph(graph: StoredGraphInput | undefined): LoadedGraph {
  const nodes: WorkflowNodeType[] = [];
  for (const raw of graph?.nodes ?? []) {
    const node = toNode(raw);
    if (node) nodes.push(node);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set<string>();
  const edges: Edge[] = [];
  for (const raw of graph?.edges ?? []) {
    const edge = toEdge(raw);
    if (!edge || edgeIds.has(edge.id)) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  return { nodes: migrateKeys(nodes), edges, viewport: toViewport(graph?.viewport) };
}

/**
 * Canvas state → stored graph. Every React Flow runtime field (`selected`, `dragging`,
 * `measured`, `width`, `height`) and the runtime-only `data.status` is dropped, so a save is
 * only ever triggered by a change the user actually made.
 */
export function toStoredGraph(
  nodes: WorkflowNodeType[],
  edges: Edge[],
  viewport?: Viewport,
): StoredGraph {
  const graph: StoredGraph = {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: PAPAFLOW_NODE_TYPE,
      position: { x: node.position.x, y: node.position.y },
      data: {
        nodeType: node.data.nodeType,
        key: node.data.key,
        label: node.data.label,
        inputs: node.data.inputs,
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })),
  };

  if (viewport) graph.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };

  // The engine (Phase 2) starts from here; first trigger on the canvas wins.
  const triggerId = nodes.find((node) => NODES[node.data.nodeType]?.category === "trigger")?.id;
  if (triggerId) graph.triggerId = triggerId;

  return graph;
}

/**
 * Stable string for "is this the same graph as the one Convex already has". Key order is fixed
 * by `toStoredGraph`, so a plain stringify is enough to skip saves for selection and drag noise.
 */
export function serializeGraph(graph: StoredGraph): string {
  return JSON.stringify(graph);
}
