// Pure graph helpers shared by the `"use workflow"` orchestrator and `startRun()`. No I/O, no
// React, no Next: `workflows/run-graph.ts` runs these inside the Workflow SDK's sandbox, where
// only language primitives are available. The only import is `NODES`, and only to read a node
// definition's `category` when the stored graph has no `triggerId`.
import { DONE_HANDLE, EACH_HANDLE, LOOP_TYPE } from "@/nodes/logic/loop";
import { NODES } from "@/nodes/registry";
import type { RunEdge, RunGraph, RunNode } from "@/workflows/types";

/** The React Flow node type the canvas stores on every node (`components/canvas/graph-io.ts`). */
const PAPAFLOW_NODE_TYPE = "papaflow";

/** Default source handle: the canvas leaves `sourceHandle` null for a node's single output. */
const DEFAULT_HANDLE = "out";

/** A node key is a template root (`{{ http_request_1.body }}`), so it has to look like one. */
const NODE_KEY = /^[a-z][a-z0-9_]*$/;

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

/**
 * The node's template key. The canvas generates one on drop and stores it, so the common case is
 * "use what is there". A graph saved before keys existed — or one whose key could never appear in
 * a template, or that repeats a key another node already took — gets one derived from its type and
 * its position in the stored array: the same stored graph always yields the same keys, which is
 * what makes a template written after the migration keep resolving.
 */
function keyFor(stored: unknown, nodeType: string, index: number, taken: Set<string>): string {
  const key = toNonEmptyString(stored);
  if (key && NODE_KEY.test(key) && !taken.has(key)) return key;

  const derived = `${nodeType.replace(/\./g, "_")}_${index + 1}`;
  if (!taken.has(derived)) return derived;
  // Only reachable when an earlier node stored the very key this one would derive.
  let suffix = 2;
  while (taken.has(`${derived}_${suffix}`)) suffix++;
  return `${derived}_${suffix}`;
}

function toRunNode(raw: unknown, index: number, takenKeys: Set<string>): RunNode | null {
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
      key: keyFor(data.key, nodeType, index, takenKeys),
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
 * without scanning, edges kept in stored order so fan-out is deterministic across replays. Every
 * node also comes out with a template `key` — its own if the canvas stored a usable one, a derived
 * one otherwise (see `keyFor`) — because the run's `outputs` are keyed by key, not by id.
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
  // Two nodes sharing a template key would share an entry in the run's `outputs`.
  const takenKeys = new Set<string>();
  const storedNodes = stored.nodes ?? [];
  for (let index = 0; index < storedNodes.length; index++) {
    const node = toRunNode(storedNodes[index], index, takenKeys);
    if (!node || nodes[node.id]) continue;
    nodes[node.id] = node;
    order.push(node.id);
    takenKeys.add(node.data.key);
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
 * The parts of a graph the walk actually reads: the edges, and enough of each node to tell a Loop
 * from anything else. `RunGraph` satisfies it, and so does the canvas' own `{ nodes, edges }` —
 * which is what lets the variable picker offer `{{ $item }}` inside a loop body without the editor
 * having to build a run graph first.
 */
export type WalkableGraph = {
  nodes: Record<string, { data: { nodeType: string } }>;
  edges: readonly RunEdge[];
};

/**
 * The nodes reachable from `nodeId` through `handle` — `null`/`undefined` meaning the node's
 * default output. Edges pointing at a node that is no longer in the graph are skipped, and a
 * target wired twice is returned once so a frontier never runs the same node in parallel.
 */
export function nextNodes(graph: WalkableGraph, nodeId: string, handle?: string | null): string[] {
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

/* -------------------------------------------------------------------------------------------------
 * Loop.
 *
 * A Loop is the one node whose neighbours are not simply "what comes next": the chain hanging off
 * its `each` handle is its *body*, which the orchestrator runs once per item instead of once. All
 * of the deciding happens here, in pure functions over the stored graph, so the workflow body stays
 * a walk and the rules are unit-testable without a run (CLAUDE.md rule 4).
 * ---------------------------------------------------------------------------------------------- */

/** Whether this node repeats part of the graph. The orchestrator asks before it expands anything. */
export function isLoopNode(graph: WalkableGraph, nodeId: string): boolean {
  return graph.nodes[nodeId]?.data.nodeType === LOOP_TYPE;
}

/** Every Loop in the graph, in `nodes` order. */
export function loopNodeIds(graph: WalkableGraph): string[] {
  return Object.keys(graph.nodes).filter((id) => isLoopNode(graph, id));
}

/** Targets of every edge leaving `nodeId`, whatever handle it leaves by, in stored order. */
function outgoing(graph: WalkableGraph, nodeId: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source !== nodeId) continue;
    if (!graph.nodes[edge.target] || seen.has(edge.target)) continue;
    seen.add(edge.target);
    targets.push(edge.target);
  }
  return targets;
}

/** Everything downstream of `starts`, following every handle. Cycle-safe. */
function reachableFrom(graph: WalkableGraph, starts: readonly string[]): Set<string> {
  const seen = new Set<string>(starts);
  const queue = [...starts];
  for (let index = 0; index < queue.length; index++) {
    for (const next of outgoing(graph, queue[index])) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * The body of one Loop: the ordered chain of nodes that runs once per item.
 *
 * It starts at the first node wired to `each` and follows one edge at a time — whatever handle it
 * leaves by, because v1 is a chain and not a subgraph (a Condition inside a body is not a fork the
 * loop knows how to run). It stops at:
 *
 * - a node with nothing after it — the ordinary end of a body;
 * - the Loop itself, so a chain wired back into the loop is one pass, not an infinite one;
 * - anything reachable from the Loop's `done` handle — the join where the body ends and the rest of
 *   the workflow begins. This is what makes `each → Set → Email` and `done → Email` mean "Email
 *   once, after the loop", which is how a person draws it;
 * - a nested Loop, which is included but not walked through: v1 does not expand a loop inside a
 *   loop, and its own body is left to be recorded as `skipped`.
 *
 * A Loop with nothing on `each` has no body, and therefore runs no iterations.
 */
export function loopBody(graph: WalkableGraph, loopNodeId: string): string[] {
  const [start] = nextNodes(graph, loopNodeId, EACH_HANDLE);
  if (!start) return [];

  const stop = reachableFrom(graph, nextNodes(graph, loopNodeId, DONE_HANDLE));
  stop.add(loopNodeId);

  const body: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = start;

  while (current && !stop.has(current) && !seen.has(current)) {
    body.push(current);
    seen.add(current);
    current = isLoopNode(graph, current) ? undefined : outgoing(graph, current)[0];
  }

  return body;
}

/**
 * Every node that belongs to some Loop's body. The frontier walk skips these: a body node runs
 * inside its loop, once per item, and never as a step of the ordinary breadth-first walk.
 */
export function loopBodyNodes(graph: WalkableGraph): Set<string> {
  const body = new Set<string>();
  for (const loopNodeId of loopNodeIds(graph)) {
    for (const nodeId of loopBody(graph, loopNodeId)) body.add(nodeId);
  }
  return body;
}

/** The Loop whose body `nodeId` is on, or null — how the variable picker knows to offer `$item`. */
export function loopFor(graph: WalkableGraph, nodeId: string): string | null {
  for (const loopNodeId of loopNodeIds(graph)) {
    if (loopBody(graph, loopNodeId).includes(nodeId)) return loopNodeId;
  }
  return null;
}
