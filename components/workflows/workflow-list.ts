/**
 * The arithmetic behind the workflow list: which rows a search box and a status chip leave
 * standing, and the three short strings a row says about time.
 *
 * Pure and React-free, because every one of them is a thing that can be wrong in a way a rendered
 * component makes hard to see — an off-by-one in a countdown, a duration that rounds a 950 ms run
 * up to "1s" when it never took a second.
 */

import { describeCron } from "@/lib/schedule";

/** `workflows.status`, plus the "no filter" value the toolbar starts on. */
export type WorkflowStatusFilter = "all" | "active" | "draft" | "paused";

/** The segmented filter, in the order it reads: everything, then live, then not-yet, then off. */
export const WORKFLOW_FILTERS: { value: WorkflowStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
];

/** The little of a row this file needs: enough to match a search and count a status. */
export type FilterableWorkflow = { name: string; status: string };

/**
 * The rows a query and a status chip leave standing, in the order they arrived — the list is
 * already newest-updated first and filtering is not a reason to reshuffle it.
 */
export function filterWorkflows<T extends FilterableWorkflow>(
  rows: readonly T[],
  { query, status }: { query: string; status: WorkflowStatusFilter },
): T[] {
  const needle = query.trim().toLowerCase();

  return rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (!needle) return true;
    return row.name.toLowerCase().includes(needle);
  });
}

/** How many rows sit behind each chip. `all` is the total, so the toolbar has one source for it. */
export function statusCounts(
  rows: readonly FilterableWorkflow[],
): Record<WorkflowStatusFilter, number> {
  const counts: Record<WorkflowStatusFilter, number> = {
    all: rows.length,
    active: 0,
    draft: 0,
    paused: 0,
  };

  for (const row of rows) {
    if (row.status === "active" || row.status === "draft" || row.status === "paused") {
      counts[row.status] += 1;
    }
  }
  return counts;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long a run took, as a row shows it: `840ms`, `1.4s`, `35s`, `2m 5s`, `1h 4m`. Null while the
 * run is still going — an unfinished run has an age, not a duration, and the row already shows
 * that.
 */
export function formatRunDuration(startedAt: number, finishedAt?: number): string | null {
  if (finishedAt === undefined) return null;

  const elapsed = Math.max(0, finishedAt - startedAt);
  if (elapsed < SECOND) return `${Math.round(elapsed)}ms`;
  if (elapsed < 10 * SECOND) return `${(elapsed / SECOND).toFixed(1)}s`;
  if (elapsed < MINUTE) return `${Math.round(elapsed / SECOND)}s`;

  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    const seconds = Math.round((elapsed - minutes * MINUTE) / SECOND);
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(elapsed / HOUR);
  const minutes = Math.round((elapsed - hours * HOUR) / MINUTE);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** A wait, coarsely: `under a minute`, `40m`, `2h`, `3d`. Always rounds down, like the ages do. */
export function formatCountdown(ms: number): string {
  if (ms < MINUTE) return "under a minute";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/**
 * What a scheduled row says under its name: when the next run is due, or — when Convex has not
 * armed one yet, or the due time has passed and the tick is still on its way — the cron itself,
 * which is never wrong even when it is less useful.
 */
export function nextRunLabel(
  schedule: { cron: string; nextAt?: number },
  now: number = Date.now(),
): string {
  if (schedule.nextAt !== undefined && schedule.nextAt > now) {
    return `Next run in ${formatCountdown(schedule.nextAt - now)}`;
  }
  return describeCron(schedule.cron);
}

/** "3 runs · 7d", the caption under a row's activity strip. */
export function activityCaption(runCount7d: number): string {
  return `${runCount7d} run${runCount7d === 1 ? "" : "s"} · 7d`;
}
