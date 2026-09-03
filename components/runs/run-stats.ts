// What a page of runs adds up to. Pure and clock-injected, so the strip above the table is markup
// and the arithmetic has tests.
//
// Everything here is computed from the rows the client has actually loaded — the pages paginate,
// so "247 runs" would be a number nobody could check. The strip says "of the runs shown", and the
// window note under the table says how far back that reaches.
import type { RunStatus } from "@/components/shared/status";

/** The columns a stat needs. `Doc<"executions">` and the projected list row both satisfy it. */
export type StatsRun = {
  status: RunStatus | string;
  startedAt: number;
  finishedAt?: number;
};

export type RunStats = {
  /** Rows loaded — the population every other number here is about. */
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  queued: number;
  running: number;
  waiting: number;
  /** Runs that reached a terminal state: the denominator of the success rate. */
  finished: number;
  /** Runs that can still change — queued, running or waiting. */
  active: number;
  /** Whole percent of finished runs that completed, or null before anything has finished. */
  successRate: number | null;
  /** Mean wall-clock time of completed runs, or null when none has completed. */
  avgDurationMs: number | null;
  /** How long the oldest still-open run has been going, or null when nothing is open. */
  oldestActiveMs: number | null;
};

/** A run in one of the three states that can still change. */
export function isOpenRun(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting";
}

/**
 * The strip's five numbers, from the loaded rows.
 *
 * Two deliberate choices, both about not flattering the page:
 *
 * - the average covers *completed* runs only. A run that is still going has no duration to average,
 *   and a failed one usually stopped early, so folding either in would quietly pull the number down
 *   and make a healthy workspace look fast for the wrong reason.
 * - the success rate is judged against finished runs, cancellations included. A cancelled run did
 *   not do what it was asked to, and hiding it from the denominator would let a workspace cancel
 *   its way to 100%.
 */
export function runStats(runs: readonly StatsRun[], now: number): RunStats {
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let queued = 0;
  let running = 0;
  let waiting = 0;
  let completedMs = 0;
  let oldestActiveAt: number | null = null;

  for (const run of runs) {
    switch (run.status) {
      case "completed":
        completed += 1;
        completedMs += Math.max(0, (run.finishedAt ?? run.startedAt) - run.startedAt);
        break;
      case "failed":
        failed += 1;
        break;
      case "cancelled":
        cancelled += 1;
        break;
      case "queued":
        queued += 1;
        break;
      case "running":
        running += 1;
        break;
      case "waiting":
        waiting += 1;
        break;
    }

    if (isOpenRun(run.status) && (oldestActiveAt === null || run.startedAt < oldestActiveAt)) {
      oldestActiveAt = run.startedAt;
    }
  }

  const finished = completed + failed + cancelled;

  return {
    total: runs.length,
    completed,
    failed,
    cancelled,
    queued,
    running,
    waiting,
    finished,
    active: queued + running + waiting,
    successRate: finished === 0 ? null : Math.round((completed / finished) * 100),
    avgDurationMs: completed === 0 ? null : Math.round(completedMs / completed),
    oldestActiveMs: oldestActiveAt === null ? null : Math.max(0, now - oldestActiveAt),
  };
}
