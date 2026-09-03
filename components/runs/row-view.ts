// Everything one run says about itself, worked out once and rendered twice.
//
// A phone gets a stacked card and a desktop gets a table row, and the two must never disagree about
// what a run is called, how long it went for or where its workflow lives — so the arithmetic is
// here, pure, and both `RunRow` and `RunCard` are markup over the same object.

import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";

import { formatClock, liveDuration } from "./format";
import { isOpenRun } from "./run-stats";

/** The columns one row draws. The projected `executions.pageBy*` row satisfies it. */
export type RunRowData = {
  _id: string;
  workflowId: string;
  status: string;
  trigger: { type: string };
  startedAt: number;
  finishedAt?: number;
  error?: string;
};

export type RunRowView = {
  /** "2 minutes ago" — the age of the run against the table's shared clock. */
  started: string;
  /** The full timestamp, for a `title`. */
  absolute: string;
  /** `14:03` — the wall clock behind the relative label. */
  clock: string;
  /** How long it went for, counting up while it is still going. */
  duration: string;
  /** Still queued, running or waiting. */
  open: boolean;
  /** The workflow's name, or the placeholder for one that has been deleted. */
  name: string;
  /** The canvas, when there is still a workflow to open. */
  workflowHref: string | null;
  /** What the row announces to a screen reader. */
  label: string;
};

export function runRowView(
  run: RunRowData,
  {
    workflowName,
    showWorkflow = false,
    now,
  }: { workflowName?: string; showWorkflow?: boolean; now: number },
): RunRowView {
  const started = formatRelativeTime(run.startedAt, now);
  const name = workflowName ?? "Deleted workflow";

  return {
    started,
    absolute: formatAbsoluteTime(run.startedAt),
    clock: formatClock(run.startedAt),
    duration: liveDuration(run.startedAt, run.finishedAt, now),
    open: isOpenRun(run.status),
    name,
    workflowHref: workflowName === undefined ? null : `/w/${run.workflowId}`,
    label: `Run of ${showWorkflow ? name : "this workflow"} started ${started}`,
  };
}
