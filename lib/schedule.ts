import { Cron } from "croner";

import { limitsForPlan } from "@/lib/plans";

/**
 * The cron maths behind the Schedule trigger.
 *
 * Everything here is pure: a spec (what the trigger node stores) in, a cron string, a `Date` or a
 * verdict out. Nothing reads the clock on its own — `from` is always an argument — because the
 * scheduler computes fire times inside a `"use step"` (workflow code's `Date` is seeded, CLAUDE.md
 * rule 4) and the config panel computes them in the browser. Same answers on both sides.
 *
 * `croner@10.0.1` does the recurrence: `new Cron(expr, { timezone }).nextRun(from)` returns the
 * first occurrence strictly after `from`, or null. Constructing a `Cron` with options but no
 * callback never schedules a timer (verified in `node_modules/croner/dist/croner.js`: `schedule()`
 * is only called when a function is passed), so this is safe to import anywhere.
 */

/** How the user described the schedule. `every` generates the cron; `cron` is typed by hand. */
export type ScheduleMode = "every" | "cron";

/** The Schedule trigger's inputs, loosely typed: it comes off a `v.any()` graph. */
export type ScheduleSpec = {
  mode: ScheduleMode;
  everyMinutes?: number;
  cron?: string;
  timezone?: string;
};

/**
 * Schedules with no timezone are UTC, not the server's zone: the same workflow must fire at the
 * same instant whether the step ran in Washington or Dublin, and a preview in the browser has to
 * agree with it.
 */
export const DEFAULT_TIMEZONE = "UTC";

export const DEFAULT_EVERY_MINUTES = 60;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** How many occurrences `minIntervalMinutes` looks at; five gaps is enough to catch a burst. */
const INTERVAL_SAMPLES = 6;

export type ScheduleError =
  | { code: "invalid_cron"; message: string }
  | { code: "invalid_timezone"; message: string }
  | { code: "too_frequent"; message: string; minimumMinutes: number; intervalMinutes: number };

export type ScheduleValidation =
  | { ok: true; cron: string; timezone: string; intervalMinutes: number }
  | { ok: false; error: ScheduleError };

/** `everyMinutes` as a whole number of minutes between 1 and a day, whatever the graph stored. */
function clampMinutes(value: unknown): number {
  const minutes =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_EVERY_MINUTES;
  return Math.min(MINUTES_PER_DAY, Math.max(1, minutes));
}

/**
 * The cron expression a spec means.
 *
 * `every` is translated rather than stored, so the schedules table only ever holds cron — one
 * language for the scheduler, `croner` and the run inspector. Sub-hourly intervals become minute
 * stepping, whole hours become hour stepping, and a day is
 * midnight. An interval that is not a whole number of hours (90 minutes, say) is rounded to the
 * nearest hour, which the config panel makes visible by previewing the *resulting* fire times
 * rather than the number that was typed.
 *
 * Total by design: a `cron` mode with nothing typed yet returns `""`, which `validateSchedule`
 * turns into `invalid_cron`.
 */
export function toCron(spec: ScheduleSpec): string {
  if (spec.mode === "cron") return (spec.cron ?? "").trim();

  const minutes = clampMinutes(spec.everyMinutes);
  if (minutes < MINUTES_PER_HOUR) return `*/${minutes} * * * *`;
  if (minutes === MINUTES_PER_HOUR) return "0 * * * *";

  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  return hours >= 24 ? "0 0 * * *" : `0 */${hours} * * *`;
}

/** The zone a spec runs in: its own, an override, or UTC. */
export function timezoneFor(spec: ScheduleSpec, timezone?: string): string {
  const chosen = (timezone ?? spec.timezone ?? "").trim();
  return chosen.length > 0 ? chosen : DEFAULT_TIMEZONE;
}

/**
 * A croner job for the expression, or null when either the expression or the zone is unusable.
 * No callback is passed, so nothing is scheduled — this object only answers questions.
 */
function cronJob(cron: string, timezone: string): Cron | null {
  if (cron.trim().length === 0) return null;
  try {
    const job = new Cron(cron, { timezone });
    // A bad IANA zone only throws once a date is actually converted, so ask for one now.
    job.nextRun(new Date(0));
    return job;
  } catch {
    return null;
  }
}

/** True when the string is an IANA zone this runtime knows. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first time this schedule fires strictly after `from`, or null when the expression never
 * fires again (or is not an expression at all).
 *
 * `timezone` overrides the spec's own — the config panel previews a zone the user is still typing.
 */
export function nextFireTime(
  spec: ScheduleSpec,
  from: Date = new Date(),
  timezone?: string,
): Date | null {
  const job = cronJob(toCron(spec), timezoneFor(spec, timezone));
  return job?.nextRun(from) ?? null;
}

/** The next `count` fire times after `from` — what the config panel previews. */
export function nextFireTimes(
  spec: ScheduleSpec,
  from: Date = new Date(),
  count = 3,
  timezone?: string,
): Date[] {
  const job = cronJob(toCron(spec), timezoneFor(spec, timezone));
  if (!job || count <= 0) return [];
  return job.nextRuns(count, from);
}

/**
 * The shortest gap this expression ever leaves between two runs, in minutes.
 *
 * Judged on occurrences rather than on the text, because that is what the plan limit is actually
 * about: `0 9,10 * * *` reads as "twice a day" but puts two runs an hour apart, and two-minute
 * stepping is two minutes however it was written. `Infinity` means it fires at most once ever.
 */
export function minIntervalMinutes(
  cron: string,
  timezone: string = DEFAULT_TIMEZONE,
  from: Date = new Date(),
): number {
  const job = cronJob(cron, timezone);
  if (!job) return Infinity;

  const runs = job.nextRuns(INTERVAL_SAMPLES, from);
  let smallest = Infinity;
  for (let i = 1; i < runs.length; i++) {
    smallest = Math.min(smallest, (runs[i].getTime() - runs[i - 1].getTime()) / 60_000);
  }
  return smallest;
}

/**
 * Whether this org may run this schedule.
 *
 * Two ways to fail: the expression is not one (`invalid_cron`, also what an empty box gives), or it
 * would fire more often than the plan allows (`too_frequent`, carrying both the plan's minimum and
 * the interval that was asked for so the message can say what to change). `free_org` is 60 minutes;
 * `pro` and `team` are 1 (`lib/plans.ts`).
 *
 * `from` is an argument so the check is deterministic in tests; nothing else about the answer
 * depends on the clock.
 */
export function validateSchedule(
  spec: ScheduleSpec,
  plan: string,
  from: Date = new Date(),
): ScheduleValidation {
  const timezone = timezoneFor(spec);
  if (!isValidTimezone(timezone)) {
    return {
      ok: false,
      error: {
        code: "invalid_timezone",
        message: `${timezone} is not a timezone this app knows. Use an IANA name such as Europe/London.`,
      },
    };
  }

  const cron = toCron(spec);
  const job = cronJob(cron, timezone);
  if (!job) {
    return {
      ok: false,
      error: {
        code: "invalid_cron",
        message:
          cron.length === 0
            ? "Enter a cron expression, for example 0 9 * * * for 9am every day."
            : `${cron} is not a cron expression this app understands.`,
      },
    };
  }

  const minimumMinutes = limitsForPlan(plan).minScheduleMinutes;
  const intervalMinutes = minIntervalMinutes(cron, timezone, from);
  if (intervalMinutes < minimumMinutes) {
    return {
      ok: false,
      error: {
        code: "too_frequent",
        minimumMinutes,
        intervalMinutes,
        message: `Your plan runs a schedule at most once every ${describeMinutes(minimumMinutes)}; this one would run every ${describeMinutes(intervalMinutes)}. Upgrade, or slow the schedule down.`,
      },
    };
  }

  return { ok: true, cron, timezone, intervalMinutes };
}

/** "2 min", "1 hour", "3 hours", "1 day" — the unit a person would say it in. */
export function describeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return "never";
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  if (minutes === MINUTES_PER_HOUR) return "hour";
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return days === 1 ? "day" : `${days} days`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) return `${minutes / MINUTES_PER_HOUR} hours`;
  return `${minutes} min`;
}

/**
 * A cron expression as a phrase for a badge: "every 2 min", "every day at 09:00".
 *
 * Deliberately pattern-matching rather than a full cron-to-English translator — it recognises
 * exactly the shapes `toCron` produces plus a plain daily time, and falls back to the expression
 * itself, which is honest and never wrong.
 */
export function describeCron(cron: string): string {
  const expression = cron.trim();

  const everyMinutes = /^\*\/(\d+) \* \* \* \*$/.exec(expression);
  if (everyMinutes) return `every ${describeMinutes(Number(everyMinutes[1]))}`;

  if (expression === "0 * * * *") return "every hour";

  const everyHours = /^0 \*\/(\d+) \* \* \*$/.exec(expression);
  if (everyHours) return `every ${describeMinutes(Number(everyHours[1]) * MINUTES_PER_HOUR)}`;

  const daily = /^(\d+) (\d+) \* \* \*$/.exec(expression);
  if (daily) {
    const [, minute, hour] = daily;
    return `every day at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  return expression;
}

/** The same phrase for a spec, so the canvas and the workflow list say the same thing. */
export function describeSchedule(spec: ScheduleSpec): string {
  return describeCron(toCron(spec));
}
