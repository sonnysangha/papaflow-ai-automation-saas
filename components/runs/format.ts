// How a run's clock reads on the runs pages. Pure, so the arithmetic has tests and the components
// are markup — the same split `components/canvas/run-timeline.ts` makes for the Gantt.

/** A duration in the unit a person would say out loud: `240ms`, `1.2s`, `2m 5s`. */
export function formatSpanMs(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  if (value < 1_000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}

/**
 * How long a step or a run took, or an em dash while it is still going.
 *
 * Re-exported from `StepsSheet` because that is where it used to live and the runs table imports it
 * from there; the implementation is here so a pure helper does not drag a Convex subscription and a
 * Sheet into a unit test.
 */
export function formatDuration(startedAt: number, finishedAt?: number): string {
  if (finishedAt === undefined) return "—";
  return formatSpanMs(finishedAt - startedAt);
}

/**
 * The same duration, but honest about a run that has not finished: how long it has been going so
 * far, measured against a clock the caller owns.
 *
 * The table ticks one `now` for the whole page rather than one timer per row, so passing the clock
 * in is what keeps this pure and keeps the rows cheap.
 */
export function liveDuration(startedAt: number, finishedAt: number | undefined, now: number): string {
  return formatSpanMs((finishedAt ?? now) - startedAt);
}

/**
 * `14:03` — the wall-clock time behind a relative label, for the second line of the Started column.
 *
 * Deliberately time-only: the row already says "2 hours ago", and the full timestamp is on the
 * cell's `title` for anyone who needs the date.
 */
export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
