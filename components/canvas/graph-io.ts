// Translation between the React Flow state the canvas edits and the JSON Convex stores on
// `workflows.graph`. Nothing in here touches React so the shape stays easy to reason about
// (and to reuse from the Builder agent in Phase 12).
import type { Edge, Node, Viewport } from "@xyflow/react";

import { NODES } from "@/nodes/registry";

/** The only React Flow node type this canvas renders; stored on every node as `type`. */
export const PAPAFLOW_NODE_TYPE = "papaflow";

/** Drag payload: the sidebar writes a node `type` here, the canvas reads it on drop. */
export const NODE_DRAG_MIME = "application/papaflow-node";

/** Runtime-only; Phase 2 feeds it from the `steps` table. Never stored. */
export type NodeStatus = "idle" | "running" | "success" | "failed" | "waiting";

export type WorkflowNodeData = {
  /** Key into `NODES`, e.g. `http.request`. */
  nodeType: string;
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
      label: toOptionalString(data.label) ?? NODES[nodeType]?.name ?? nodeType,
      inputs: isRecord(data.inputs) ? data.inputs : {},
      status: "idle",
    },
  };
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

  return { nodes, edges, viewport: toViewport(graph?.viewport) };
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
