// One run, laid out as a Gantt: where every step sits on a shared time axis that starts at the
// trigger.
//
// Pure, and deliberately structural about its input — it takes the same `steps` rows the editor
// already subscribes to (`Doc<"steps">` satisfies `TimelineStep`), so the whole layout is
// unit-testable without Convex, React or a run. Nothing here reads a secret: the rows carry
// `nodeId`, `status` and timestamps, never `input`/`output`.
//
// Everything the panel needs to draw is computed here as percentages of the axis, so the component
// is markup and the arithmetic has tests.
import { NODES } from "@/nodes/registry";

import type { RunStepStatus } from "./last-run";

/**
 * The `steps` columns the timeline reads. `Doc<"steps">` is assignable to it, and a test can write
 * one by hand.
 */
export type TimelineStep = {
  _id: string;
  nodeId: string;
  nodeType: string;
  status: RunStepStatus;
  attempt: number;
  startedAt: number;
  finishedAt?: number;
  /** The 0-based Loop pass, absent for a node that runs once. */
  iteration?: number;
  error?: string;
  /** Set on the rows a node spawned (the Agent node's tool calls), which are not graph nodes. */
  parentStepId?: string;
};

/** What a node is called on the canvas, both ways — the same pair the node itself shows. */
export type NodeNames = { label: string; key: string };

/** A tool call the Agent node made, written by `runNode` as `agent.tool:<name>`. */
const TOOL_PREFIX = "agent.tool:";

/** One drawn row: a step, its place on the axis, and the gap in front of it. */
export type TimelineRow = {
  /** The step row's own id — stable across the subscription, so it keys the list. */
  id: string;
  nodeId: string;
  /** The node's canvas label, the registry name, or the tool's own name for a child row. */
  label: string;
  /** The name templates address the node by. Empty for a tool call, which has none. */
  nodeKey: string;
  /** `2/3` for the second of three passes over a loop body; null for a node that runs once. */
  pass: string | null;
  /** A row the Agent node spawned: drawn indented under the step that made it. */
  child: boolean;
  status: RunStepStatus;
  attempt: number;
  error?: string;
  /** Offset from the run's start, in ms. */
  startMs: number;
  /** Where the bar ends: the step's own end, or the axis end while it is still going. */
  endMs: number;
  /** How long the step took, or null while it is still going. */
  durationMs: number | null;
  /** Still running or waiting — the bar is open-ended and pulses. */
  open: boolean;
  leftPct: number;
  widthPct: number;
  /** Dead time between the previous row's end and this row's start, or null when there is none. */
  gapMs: number | null;
  gapLeftPct: number | null;
  gapWidthPct: number | null;
};

export type TimelineTick = { atMs: number; leftPct: number; label: string };

export type Timeline = {
  rows: TimelineRow[];
  ticks: TimelineTick[];
  /** The width of the axis in ms — never zero, so a percentage is always defined. */
  spanMs: number;
  /** Wall-clock time of t=0: the trigger. */
  originAt: number;
};

/** A bar this narrow is still a bar: a 3ms step on a five-minute axis has to be clickable. */
const MIN_WIDTH_PCT = 0.7;

/** …and a gap thinner than this is not worth drawing. */
const MIN_GAP_MS = 1;

/**
 * Groups the flat `steps` list into execution order: every top-level row in the order it was
 * created, each followed by the rows it spawned.
 *
 * The same rule the runs drawer nests by — a child carries `parentStepId`, and a child whose parent
 * is not on this page is promoted rather than dropped.
 */
export function orderSteps(steps: readonly TimelineStep[]): TimelineStep[] {
  const children = new Map<string, TimelineStep[]>();
  for (const step of steps) {
    if (!step.parentStepId) continue;
    const siblings = children.get(step.parentStepId);
    if (siblings) siblings.push(step);
    else children.set(step.parentStepId, [step]);
  }

  const parents = new Set(steps.filter((step) => !step.parentStepId).map((step) => step._id));
  const ordered: TimelineStep[] = [];
  for (const step of steps) {
    if (step.parentStepId && parents.has(step.parentStepId)) continue;
    ordered.push(step);
    for (const child of children.get(step._id) ?? []) ordered.push(child);
  }
  return ordered;
}

/**
 * How many rows each node has in this run — one, unless it is on a Loop body, where it has one per
 * pass. The denominator of "2/3", so a run still going shows the passes so far.
 */
export function passCounts(steps: readonly TimelineStep[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of steps) {
    if (step.iteration === undefined) continue;
    counts[step.nodeId] = (counts[step.nodeId] ?? 0) + 1;
  }
  return counts;
}

/**
 * What to call a row: the node's own label off the canvas, the registry's name when the graph no
 * longer has that node, and the tool's name for an Agent sub-step.
 */
export function rowLabel(step: TimelineStep, names?: NodeNames): string {
  if (step.nodeType.length === 0) return names?.label || "Not reached";
  if (step.nodeType.startsWith(TOOL_PREFIX)) return step.nodeType.slice(TOOL_PREFIX.length);
  return names?.label || NODES[step.nodeType]?.name || step.nodeType;
}

/** The tick spacing a span of this width reads best at, from a 1-2-5 ladder in real time units. */
const TICK_LADDER: readonly number[] = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000,
  300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000,
];

/**
 * The gap between ticks: the smallest rung of the ladder that keeps the axis at or under `target`
 * labels. Rungs are the numbers a person reads off a clock (250ms, 15s, 5m), never `span / 6`.
 */
export function tickStepMs(spanMs: number, target = 5): number {
  const ideal = Math.max(spanMs, 1) / Math.max(target, 1);
  return TICK_LADDER.find((step) => step >= ideal) ?? TICK_LADDER[TICK_LADDER.length - 1];
}

/** A duration in the unit a person would say out loud: `240ms`, `1.2s`, `2m 5s`. */
export function formatSpan(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  if (value < 1_000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}

/**
 * An axis label. The *step* picks the unit, not the value, so a ruler never mixes `900ms` with
 * `1.2s`: at a 500ms step every tick is milliseconds, at a 5s step every tick is seconds.
 */
export function formatTick(atMs: number, stepMs: number): string {
  if (atMs <= 0) return "0";
  if (stepMs < 1_000) return `${Math.round(atMs)}ms`;
  if (stepMs < 60_000) {
    const seconds = atMs / 1_000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(atMs / 60_000);
  const seconds = Math.round((atMs % 60_000) / 1_000);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** `+1.2s` — where a bar starts, relative to the trigger. `+0ms` reads as "start". */
export function formatOffset(ms: number): string {
  return ms <= 0 ? "start" : `+${formatSpan(ms)}`;
}

/** Ticks across the axis, at most `max` of them, the last one on or before the end. */
export function ticksFor(spanMs: number, target = 5, max = 12): TimelineTick[] {
  const step = tickStepMs(spanMs, target);
  const ticks: TimelineTick[] = [];
  for (let at = 0; at <= spanMs && ticks.length < max; at += step) {
    ticks.push({ atMs: at, leftPct: (at / spanMs) * 100, label: formatTick(at, step) });
  }
  return ticks;
}

/** The names in a stored graph, by node id — a run records ids, and labels live on the canvas. */
export function graphNodeNames(graph: unknown): Record<string, NodeNames> {
  const names: Record<string, NodeNames> = {};
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  for (const entry of Array.isArray(nodes) ? nodes : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, data } = entry as { id?: unknown; data?: unknown };
    if (typeof id !== "string" || typeof data !== "object" || data === null) continue;
    const { label, key } = data as { label?: unknown; key?: unknown };
    names[id] = {
      label: typeof label === "string" ? label : "",
      key: typeof key === "string" ? key : "",
    };
  }
  return names;
}

export type BuildTimelineArgs = {
  /** The run's rows, oldest first — exactly what `steps.byExecution` returns. */
  steps: readonly TimelineStep[];
  /** The execution's own start. t=0, even before the trigger's row exists. */
  startedAt: number;
  /** The execution's end, when it has one; an open run is measured against `now` instead. */
  finishedAt?: number;
  /** Passed in rather than read, so the layout is pure and a test can hold the clock still. */
  now: number;
  /** Node id → canvas names, from `graphNodeNames`. */
  names?: Record<string, NodeNames>;
};

/**
 * One run as rows on a shared axis.
 *
 * t=0 is the trigger: the earliest step's start, falling back to the execution's own `startedAt`
 * for a run that has not recorded one yet. (The two are milliseconds apart — the execution row is
 * written just before the durable run is handed off — and anchoring on the step is what puts the
 * trigger's bar flush against the left edge instead of behind a sliver of hand-off latency.) The
 * axis ends at the last thing that happened: the run's own end, the latest `finishedAt`, or `now`
 * while something is still going, which is what makes an open bar grow while you watch it.
 *
 * A step that has not finished has `durationMs: null` and a bar that runs to the end of the axis:
 * the honest statement is "still going", not a duration that keeps changing. The gap in front of a
 * row is measured from the previous row's *end*, which is the thing a stepped chart is for — you
 * can see that node three started 4 seconds after node two finished.
 */
export function buildTimeline({
  steps,
  startedAt,
  finishedAt,
  now,
  names = {},
}: BuildTimelineArgs): Timeline {
  const ordered = orderSteps(steps);
  const passes = passCounts(steps);

  const originAt = ordered.reduce(
    (earliest, step) => Math.min(earliest, step.startedAt),
    ordered.length > 0 ? ordered[0].startedAt : startedAt,
  );
  const latest = ordered.reduce(
    (end, step) => Math.max(end, step.finishedAt ?? now),
    Math.max(finishedAt ?? originAt, originAt),
  );
  // Never zero: a run whose every step finished in the same millisecond still needs an axis.
  const spanMs = Math.max(latest - originAt, 1);

  const rows: TimelineRow[] = [];
  let previousEndMs: number | null = null;

  for (const step of ordered) {
    const finished = step.finishedAt;
    const open = finished === undefined;
    const startMs = Math.max(0, step.startedAt - originAt);
    const endMs = finished === undefined ? spanMs : Math.max(startMs, finished - originAt);
    const durationMs = open ? null : endMs - startMs;

    const leftPct = (startMs / spanMs) * 100;
    const widthPct = Math.min(
      100 - leftPct,
      Math.max(((endMs - startMs) / spanMs) * 100, MIN_WIDTH_PCT),
    );

    const since = previousEndMs;
    const gapMs = since !== null && startMs - since >= MIN_GAP_MS ? startMs - since : null;

    rows.push({
      id: step._id,
      nodeId: step.nodeId,
      label: rowLabel(step, names[step.nodeId]),
      nodeKey: step.parentStepId ? "" : names[step.nodeId]?.key || step.nodeType,
      pass:
        step.iteration === undefined
          ? null
          : `${step.iteration + 1}/${Math.max(passes[step.nodeId] ?? 1, 1)}`,
      child: step.parentStepId !== undefined,
      status: step.status,
      attempt: step.attempt,
      error: step.error,
      startMs,
      endMs,
      durationMs,
      open,
      leftPct,
      widthPct,
      gapMs,
      gapLeftPct: gapMs === null || since === null ? null : (since / spanMs) * 100,
      gapWidthPct: gapMs === null ? null : (gapMs / spanMs) * 100,
    });

    // Measured against the row that ran last, not the row above it in the list: a tool call that
    // finishes after its parent must not make the next node look instant.
    previousEndMs = Math.max(previousEndMs ?? 0, open ? spanMs : endMs);
  }

  return { rows, ticks: ticksFor(spanMs), spanMs, originAt };
}
