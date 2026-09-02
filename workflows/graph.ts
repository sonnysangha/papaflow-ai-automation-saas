// Pure graph helpers shared by the `"use workflow"` orchestrator and `startRun()`. No I/O, no
// React, no Next: `workflows/run-graph.ts` runs these inside the Workflow SDK's sandbox, where
// only language primitives are available. The only import is `NODES`, and only to read a node
// definition's `category` when the stored graph has no `triggerId`.
import { NODES } from "@/nodes/registry";
import type { RunEdge, RunGraph, RunNode } from "@/workflows/types";

/** The React Flow node type the canvas stores on every node (`components/canvas/graph-io.ts`). */
const PAPAFLOW_NODE_TYPE = "papaflow";

/** Default source handle: the canvas leaves `sourceHandle` null for a node's single output. */
const DEFAULT_HANDLE = "out";

/**
 * The graph as it comes back from Convex, where `workflows.graph` is `v.any()`. Everything is
 * optional and `unknown`: a stored graph is user data that an older app version wrote, so
 * `toRunGraph` validates rather than trusts it.
 */
export type StoredGraphInput = {
  nodes?: unknown[];
  edges?: unknown[];
  triggerId?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toRunNode(raw: unknown): RunNode | null {
  if (!isRecord(raw)) return null;

  const id = toNonEmptyString(raw.id);
  if (!id) return null;

  const data = isRecord(raw.data) ? raw.data : {};
  const nodeType = toNonEmptyString(data.nodeType);
  if (!nodeType) return null;

  const connectionId = toNonEmptyString(data.connectionId);

  return {
    id,
    type: toNonEmptyString(raw.type) ?? PAPAFLOW_NODE_TYPE,
    data: {
      nodeType,
      label: toNonEmptyString(data.label) ?? NODES[nodeType]?.name ?? nodeType,
      inputs: isRecord(data.inputs) ? data.inputs : {},
      ...(connectionId ? { connectionId } : {}),
    },
  };
}

function toRunEdge(raw: unknown): RunEdge | null {
  if (!isRecord(raw)) return null;

  const id = toNonEmptyString(raw.id);
  const source = toNonEmptyString(raw.source);
  const target = toNonEmptyString(raw.target);
  if (!id || !source || !target) return null;

  return {
    id,
    source,
    target,
    sourceHandle: toNonEmptyString(raw.sourceHandle) ?? null,
    targetHandle: toNonEmptyString(raw.targetHandle) ?? null,
  };
}

/**
 * Stored graph → the shape `runGraph` walks: nodes keyed by id so the workflow can look one up
 * without scanning, edges kept in stored order so fan-out is deterministic across replays.
 *
 * The trigger is `stored.triggerId` when that node still exists (the canvas derives it on every
 * save), otherwise the first node whose definition is in the `trigger` category — which is what
 * a graph saved before `triggerId` existed, or one written by the Builder agent, looks like.
 * Dangling edges are kept: `nextNodes` is the one place that decides a target is unreachable.
 *
 * @throws Error("no trigger node") when nothing can start the run.
 */
export function toRunGraph(stored: StoredGraphInput): RunGraph {
  const nodes: Record<string, RunNode> = {};
  // Object key order is not insertion order for numeric-looking ids, so the stored order is
  // tracked separately: "first trigger on the canvas wins" has to mean the same thing here.
  const order: string[] = [];
  for (const raw of stored.nodes ?? []) {
    const node = toRunNode(raw);
    if (!node || nodes[node.id]) continue;
    nodes[node.id] = node;
    order.push(node.id);
  }

  const edges: RunEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of stored.edges ?? []) {
    const edge = toRunEdge(raw);
    if (!edge || edgeIds.has(edge.id)) continue;
    edgeIds.add(edge.id);
    edges.push(edge);
  }

  const storedTriggerId = toNonEmptyString(stored.triggerId);
  const triggerId =
    storedTriggerId && nodes[storedTriggerId]
      ? storedTriggerId
      : order.find((id) => NODES[nodes[id].data.nodeType]?.category === "trigger");

  if (!triggerId) throw new Error("no trigger node");

  return { triggerId, nodes, edges };
}

/**
 * The nodes reachable from `nodeId` through `handle` — `null`/`undefined` meaning the node's
 * default output. Edges pointing at a node that is no longer in the graph are skipped, and a
 * target wired twice is returned once so a frontier never runs the same node in parallel.
 */
export function nextNodes(graph: RunGraph, nodeId: string, handle?: string | null): string[] {
  const wanted = handle ?? DEFAULT_HANDLE;
  const targets: string[] = [];
  const seen = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.source !== nodeId) continue;
    if ((edge.sourceHandle ?? DEFAULT_HANDLE) !== wanted) continue;
    if (!graph.nodes[edge.target] || seen.has(edge.target)) continue;
    seen.add(edge.target);
    targets.push(edge.target);
  }

  return targets;
}

/**
 * The node ids the walk never reached — the rows `runGraph` marks `skipped` so the canvas can
 * grey out the branch that was not taken.
 */
export function unvisited(graph: RunGraph, visited: ReadonlySet<string>): string[] {
  return Object.keys(graph.nodes).filter((id) => !visited.has(id));
}
