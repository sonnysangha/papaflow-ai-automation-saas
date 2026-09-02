/**
 * "updated 5 minutes ago" without a date library. Deliberately coarse — the list only needs to show
 * recency — and it always rounds down, so a label never claims more time has passed than has.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * Formats `timestamp` as an age relative to `now`. Timestamps in the future (a client clock running
 * behind Convex) collapse to "just now" rather than showing a negative age.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = now - timestamp;
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return ago(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return ago(Math.floor(elapsed / HOUR), "hour");
  if (elapsed < WEEK) return ago(Math.floor(elapsed / DAY), "day");
  if (elapsed < MONTH) return ago(Math.floor(elapsed / WEEK), "week");
  if (elapsed < YEAR) return ago(Math.floor(elapsed / MONTH), "month");
  return ago(Math.floor(elapsed / YEAR), "year");
}

/** The exact time, for the `title` tooltip behind the relative label. Client-side only. */
export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
