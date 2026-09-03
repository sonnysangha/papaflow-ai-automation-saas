// What the latest run actually produced, arranged for the node you have selected: the data each
// node above it returned (with a preview per path, so a template can be picked by its value rather
// than guessed from a schema) and this node's own recorded input and output.
//
// Pure, and deliberately structural about its input: it takes the `steps` rows the editor already
// subscribes to — `Doc<"steps">` satisfies `RunStepRow` — so the whole thing is unit-testable
// without Convex, React Flow or a run. Nothing here reads a secret: `steps.input` was redacted by
// `runNode` before it was written (CLAUDE.md rule 1), and `steps.output` is node output.
import type { Edge } from "@xyflow/react";

import type { OutputPath } from "@/nodes/paths";
import { NODES } from "@/nodes/registry";

import { upstreamNodeIds, type NodeStatus, type WorkflowNodeType } from "./graph-io";
import { pathsFromValue } from "./paths-from-value";

/** The reserved template root that resolves to the trigger's payload in every node's context. */
export const TRIGGER_ROOT = "trigger";

/** Every `steps.status`; a row exists only once a node has started, so `idle` is not one of them. */
export type RunStepStatus = Exclude<NodeStatus, "idle">;

/**
 * The `steps` columns the editor reads. Structural on purpose: `Doc<"steps">` is assignable to it,
 * and a test can write one by hand.
 */
export type RunStepRow = {
  nodeId: string;
  status: RunStepStatus;
  /** The resolved inputs the node ran with, already redacted by the engine. */
  input?: unknown;
  output?: unknown;
  error?: string;
  handle?: string;
  /** The 0-based Loop pass, absent for a node that runs once. */
  iteration?: number;
  startedAt: number;
  finishedAt?: number;
  /** Set on the rows a node spawned (the Agent node's tool calls), which are not graph nodes. */
  parentStepId?: string;
};

/** One path inside a recorded output, and what was actually sitting at it. */
export type PathPreview = OutputPath & { preview: string };

/** A root a template can start with, as the last run left it. */
export type LastRunSource = {
  /** Graph node id — two nodes can carry the same label, never the same id. */
  nodeId: string;
  /** The template root: this node's key, or the reserved `trigger`. */
  key: string;
  /** Registry type, so a caller can add the paths the node's `outputs` schema declares. */
  nodeType: string;
  /** The node's canvas label. */
  label: string;
  /** True for the reserved `trigger` root rather than the node's own key. */
  reserved: boolean;
  /** What the node returned in the latest run — `undefined` when it has no row in it. */
  output: unknown;
  /** Whether the latest run recorded this node at all. */
  ran: boolean;
  /** Concrete paths inside `output`, each with a one-line preview of its value. */
  paths: PathPreview[];
};

/** The selected node's own row in the latest run. */
export type LastRunStep = {
  status: RunStepStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  iteration?: number;
  startedAt: number;
  finishedAt?: number;
  /** How long the step took, once it has finished; `undefined` while it is still going. */
  durationMs?: number;
};

export type LastRun = {
  /** Upstream nodes, nearest first, then the reserved `trigger` root. */
  sources: LastRunSource[];
  /** The selected node's own step, or null when the latest run never reached it. */
  self: LastRunStep | null;
};

/** Long enough to recognise a value, short enough to sit on one line of the picker. */
const MAX_PREVIEW = 40;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One line describing a value: the string itself (whitespace collapsed, truncated), the number or
 * boolean as written, `[3 items]` for an array and `{…}` for an object — a shape, not a dump.
 * `undefined` previews as the empty string, which is how a caller says "there was nothing here".
 */
export function previewOf(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";

  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length === 0) return '""';
    return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
  }

  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 1 ? "[1 item]" : `[${value.length} items]`;
  if (isPlainObject(value)) return Object.keys(value).length === 0 ? "{}" : "{…}";
  return String(value);
}

/** `a.b[0].c` → `["a", "b", "0", "c"]`, the same reading `resolveTemplates` gives a path. */
function segmentsOf(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".");
}

/**
 * The value at one of `pathsFromValue`'s paths. Own properties only, like template resolution:
 * a path the picker offers is one the run will find, or nothing at all.
 */
export function valueAt(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of segmentsOf(path)) {
    if (typeof current !== "object" || current === null) return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Every path inside a recorded output, each carrying a preview of the value that was there. */
export function pathPreviews(value: unknown): PathPreview[] {
  return pathsFromValue(value).map((path) => ({
    ...path,
    preview: previewOf(valueAt(value, path.path)),
  }));
}

/**
 * The row that speaks for each node in one run: its last one.
 *
 * A node on a Loop body has a row per pass, so the highest `iteration` wins — the data in front of
 * you is the pass that just happened, not the one three items ago. Rows arrive in creation order,
 * so an equal `iteration` (and the absent one every node outside a loop has) resolves to the later
 * row: a retry replaces the attempt it retried.
 *
 * Rows a node spawned are skipped. They are addressed `${nodeId}#${index}` and belong to a tool
 * call, not to a node anything can reference in a template.
 */
export function latestStepByNode(steps: readonly RunStepRow[]): Record<string, RunStepRow> {
  const byNode: Record<string, RunStepRow> = {};
  for (const step of steps) {
    if (step.parentStepId !== undefined) continue;
    const previous = byNode[step.nodeId];
    if (previous && (step.iteration ?? 0) < (previous.iteration ?? 0)) continue;
    byNode[step.nodeId] = step;
  }
  return byNode;
}

/**
 * The rows a panel should read while a new run is starting: the current run's, backed by the
 * previous run's for every node the current one has not reached yet.
 *
 * Two things go empty the moment you press Run — a Convex subscription whose args just changed
 * answers `undefined`, and a fresh execution has no rows at all for the nodes further down the
 * graph — so without this the data you are reading disappears and comes back node by node, seconds
 * later. Carrying the previous rows over keeps the last thing each node produced in front of you
 * until the new run replaces it. The canvas is deliberately not fed this: its rings are about the
 * run in progress and reset to idle for it.
 *
 * Rows are carried per node rather than merged inside one, so `latestStepByNode` is never asked to
 * choose between two runs' passes of the same node: a node the current run has touched at all is
 * represented only by the current run's rows.
 */
export function carryOverSteps(
  previous: readonly RunStepRow[],
  current: readonly RunStepRow[],
): readonly RunStepRow[] {
  if (previous.length === 0) return current;

  const reached = new Set(current.map((step) => step.nodeId));
  const carried = previous.filter((step) => !reached.has(step.nodeId));
  // Identity is the caller's memo key, so an untouched answer has to stay the same array.
  return carried.length === 0 ? current : [...carried, ...current];
}

function sourceFor(
  node: WorkflowNodeType,
  key: string,
  step: RunStepRow | undefined,
  reserved: boolean,
): LastRunSource {
  return {
    nodeId: node.id,
    key,
    nodeType: node.data.nodeType,
    label: node.data.label,
    reserved,
    output: step?.output,
    ran: step !== undefined,
    paths: pathPreviews(step?.output),
  };
}

function selfFor(step: RunStepRow): LastRunStep {
  return {
    status: step.status,
    input: step.input,
    output: step.output,
    error: step.error,
    iteration: step.iteration,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    durationMs:
      step.finishedAt === undefined ? undefined : Math.max(0, step.finishedAt - step.startedAt),
  };
}

/**
 * What the latest run has to say about one node: the data every root in its scope holds, and its
 * own step.
 *
 * The roots are its ancestors, nearest first — the outputs a template may reference — followed by
 * `trigger`, which resolves in every node's context whether or not the trigger is an ancestor. A
 * trigger that *is* an ancestor appears twice on purpose: once under its own key and once under
 * the reserved root, because both spellings resolve.
 */
export function lastRunFor({
  nodeId,
  nodes,
  edges,
  steps,
}: {
  nodeId: string;
  nodes: readonly WorkflowNodeType[];
  edges: readonly Edge[];
  /** The latest execution's rows, in creation order. Empty before the workflow has ever run. */
  steps: readonly RunStepRow[];
}): LastRun {
  const latest = latestStepByNode(steps);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sources: LastRunSource[] = [];

  for (const id of upstreamNodeIds(edges, nodeId)) {
    const node = byId.get(id);
    // A node whose key never migrated cannot be referenced, so it is not offered.
    if (!node || !node.data.key) continue;
    sources.push(sourceFor(node, node.data.key, latest[id], false));
  }

  const trigger = nodes.find((node) => NODES[node.data.nodeType]?.category === "trigger");
  if (trigger) sources.push(sourceFor(trigger, TRIGGER_ROOT, latest[trigger.id], true));

  const step = latest[nodeId];
  return { sources, self: step ? selfFor(step) : null };
}

/** Rounded to the unit a person would use out loud, with `now` passed in so it stays pure. */
export function relativeTime(at: number, now: number): string {
  const ms = now - at;
  // A clock a few seconds behind the server must not read "in 4 seconds".
  if (ms < 45_000) return "just now";

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(ms / 86_400_000)}d ago`;
}
