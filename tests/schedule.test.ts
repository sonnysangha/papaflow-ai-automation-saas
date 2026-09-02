import { describe, expect, it } from "vitest";

import { PLAN_LIMITS } from "@/lib/plans";
import {
  DEFAULT_TIMEZONE,
  describeCron,
  describeSchedule,
  minIntervalMinutes,
  nextFireTime,
  nextFireTimes,
  toCron,
  validateSchedule,
} from "@/lib/schedule";

/**
 * The cron maths behind the Schedule trigger.
 *
 * Every case pins `from` and a timezone: the whole point of `lib/schedule.ts` is that a fire time
 * computed in a step on a Vercel box and one previewed in a browser in Sydney are the same instant,
 * so a test that leaned on the machine's clock or zone would be testing the wrong thing.
 */

/** A Tuesday, 08:30 UTC. Far enough from any boundary that the arithmetic is easy to read. */
const FROM = new Date("2026-09-02T08:30:00.000Z");

describe("toCron", () => {
  it("turns whole-minute intervals into minute stepping", () => {
    expect(toCron({ mode: "every", everyMinutes: 1 })).toBe("*/1 * * * *");
    expect(toCron({ mode: "every", everyMinutes: 2 })).toBe("*/2 * * * *");
    expect(toCron({ mode: "every", everyMinutes: 15 })).toBe("*/15 * * * *");
  });

  it("turns an hour and multiples of it into hour stepping, and a day into midnight", () => {
    expect(toCron({ mode: "every", everyMinutes: 60 })).toBe("0 * * * *");
    expect(toCron({ mode: "every", everyMinutes: 120 })).toBe("0 */2 * * *");
    expect(toCron({ mode: "every", everyMinutes: 720 })).toBe("0 */12 * * *");
    expect(toCron({ mode: "every", everyMinutes: 1440 })).toBe("0 0 * * *");
  });

  it("rounds an interval that is not a whole number of hours, and clamps the ends", () => {
    expect(toCron({ mode: "every", everyMinutes: 90 })).toBe("0 */2 * * *");
    expect(toCron({ mode: "every", everyMinutes: 0 })).toBe("*/1 * * * *");
    expect(toCron({ mode: "every", everyMinutes: 99_999 })).toBe("0 0 * * *");
  });

  it("defaults to hourly when the graph stored no interval at all", () => {
    expect(toCron({ mode: "every" })).toBe("0 * * * *");
    expect(toCron({ mode: "every", everyMinutes: Number.NaN })).toBe("0 * * * *");
  });

  it("passes a hand-written expression through, trimmed", () => {
    expect(toCron({ mode: "cron", cron: "  0 9 * * 1-5 " })).toBe("0 9 * * 1-5");
    expect(toCron({ mode: "cron" })).toBe("");
  });
});

describe("nextFireTime", () => {
  it("finds the next occurrence strictly after `from`", () => {
    const spec = { mode: "cron" as const, cron: "0 9 * * *", timezone: "UTC" };
    expect(nextFireTime(spec, FROM)?.toISOString()).toBe("2026-09-02T09:00:00.000Z");

    // Exactly on an occurrence: the *next* one, never the one that just happened, or a schedule
    // would fire twice the moment a replay recomputed it.
    const onTheHour = new Date("2026-09-02T09:00:00.000Z");
    expect(nextFireTime(spec, onTheHour)?.toISOString()).toBe("2026-09-03T09:00:00.000Z");
  });

  it("steps every-N schedules from the following boundary", () => {
    const from = new Date("2026-09-02T08:31:10.000Z");
    expect(nextFireTime({ mode: "every", everyMinutes: 2, timezone: "UTC" }, from)?.toISOString()).toBe(
      "2026-09-02T08:32:00.000Z",
    );
  });

  it("reads the expression in the schedule's timezone", () => {
    const spec = { mode: "cron" as const, cron: "0 9 * * *" };

    // 9am New York in September is EDT (UTC-4).
    expect(nextFireTime({ ...spec, timezone: "America/New_York" }, FROM)?.toISOString()).toBe(
      "2026-09-02T13:00:00.000Z",
    );
    // …and 9am Tokyo (UTC+9) has already gone by 08:30 UTC, so it is tomorrow's.
    expect(nextFireTime({ ...spec, timezone: "Asia/Tokyo" }, FROM)?.toISOString()).toBe(
      "2026-09-03T00:00:00.000Z",
    );
  });

  it("treats a schedule with no timezone as UTC", () => {
    const spec = { mode: "cron" as const, cron: "0 9 * * *" };
    expect(nextFireTime(spec, FROM)?.toISOString()).toBe(
      nextFireTime({ ...spec, timezone: DEFAULT_TIMEZONE }, FROM)?.toISOString(),
    );
  });

  it("lets an explicit timezone argument override the spec's own", () => {
    const spec = { mode: "cron" as const, cron: "0 9 * * *", timezone: "UTC" };
    expect(nextFireTime(spec, FROM, "America/New_York")?.toISOString()).toBe(
      "2026-09-02T13:00:00.000Z",
    );
  });

  it("answers null for an expression that is not one, or a zone that is not one", () => {
    expect(nextFireTime({ mode: "cron", cron: "not a cron" }, FROM)).toBeNull();
    expect(nextFireTime({ mode: "cron", cron: "" }, FROM)).toBeNull();
    expect(nextFireTime({ mode: "cron", cron: "0 9 * * *", timezone: "Mars/Olympus" }, FROM)).toBeNull();
  });
});

describe("nextFireTimes", () => {
  it("previews the next few occurrences in order", () => {
    const times = nextFireTimes({ mode: "every", everyMinutes: 2, timezone: "UTC" }, FROM, 3);
    expect(times.map((time) => time.toISOString())).toEqual([
      "2026-09-02T08:32:00.000Z",
      "2026-09-02T08:34:00.000Z",
      "2026-09-02T08:36:00.000Z",
    ]);
  });

  it("is empty for an unusable expression rather than throwing at the config panel", () => {
    expect(nextFireTimes({ mode: "cron", cron: "nope" }, FROM)).toEqual([]);
    expect(nextFireTimes({ mode: "every", everyMinutes: 5 }, FROM, 0)).toEqual([]);
  });
});

describe("minIntervalMinutes", () => {
  it("measures the gap between occurrences, not the shape of the expression", () => {
    expect(minIntervalMinutes("*/2 * * * *", "UTC", FROM)).toBe(2);
    expect(minIntervalMinutes("0 * * * *", "UTC", FROM)).toBe(60);
    expect(minIntervalMinutes("0 0 * * *", "UTC", FROM)).toBe(1440);
    // Reads as "twice a day", but puts two runs an hour apart — which is what the plan cares about.
    expect(minIntervalMinutes("0 9,10 * * *", "UTC", FROM)).toBe(60);
  });

  it("is Infinity for an expression that never fires", () => {
    expect(minIntervalMinutes("not a cron", "UTC", FROM)).toBe(Infinity);
  });
});

describe("validateSchedule", () => {
  it("accepts an hourly schedule on the free plan", () => {
    const result = validateSchedule({ mode: "every", everyMinutes: 60 }, "free_org", FROM);
    expect(result).toEqual({ ok: true, cron: "0 * * * *", timezone: "UTC", intervalMinutes: 60 });
  });

  it("refuses a sub-hourly schedule on the free plan, naming the plan's minimum", () => {
    const result = validateSchedule({ mode: "every", everyMinutes: 2 }, "free_org", FROM);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the free plan to refuse a two-minute schedule");

    expect(result.error.code).toBe("too_frequent");
    if (result.error.code !== "too_frequent") return;
    expect(result.error.minimumMinutes).toBe(PLAN_LIMITS.free_org.minScheduleMinutes);
    expect(result.error.intervalMinutes).toBe(2);
    expect(result.error.message).toMatch(/hour/);
    expect(result.error.message).toMatch(/2 min/);
  });

  it("accepts the same schedule on a paid plan", () => {
    expect(validateSchedule({ mode: "every", everyMinutes: 2 }, "pro", FROM)).toEqual({
      ok: true,
      cron: "*/2 * * * *",
      timezone: "UTC",
      intervalMinutes: 2,
    });
  });

  it("judges a hand-written cron by what it actually does, not by how it reads", () => {
    const result = validateSchedule({ mode: "cron", cron: "0 9,10 * * *" }, "free_org", FROM);
    expect(result).toEqual({ ok: true, cron: "0 9,10 * * *", timezone: "UTC", intervalMinutes: 60 });

    const tooOften = validateSchedule({ mode: "cron", cron: "*/5 * * * *" }, "free_org", FROM);
    expect(tooOften.ok).toBe(false);
  });

  it("refuses an expression that is not a cron", () => {
    const result = validateSchedule({ mode: "cron", cron: "every tuesday" }, "pro", FROM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_cron");
    expect(result.error.message).toMatch(/every tuesday/);
  });

  it("refuses an empty expression with something a user can act on", () => {
    const result = validateSchedule({ mode: "cron" }, "pro", FROM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_cron");
    expect(result.error.message).toMatch(/0 9 \* \* \*/);
  });

  it("refuses a timezone this runtime does not know", () => {
    const result = validateSchedule(
      { mode: "every", everyMinutes: 60, timezone: "Mars/Olympus" },
      "pro",
      FROM,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_timezone");
  });

  it("falls back to the free plan's limits for a plan slug it does not know", () => {
    const result = validateSchedule({ mode: "every", everyMinutes: 2 }, "enterprise_unicorn", FROM);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== "too_frequent") return;
    expect(result.error.minimumMinutes).toBe(PLAN_LIMITS.free_org.minScheduleMinutes);
  });
});

describe("describeCron / describeSchedule", () => {
  it("says what a generated expression means", () => {
    expect(describeCron("*/2 * * * *")).toBe("every 2 min");
    expect(describeCron("0 * * * *")).toBe("every hour");
    expect(describeCron("0 */6 * * *")).toBe("every 6 hours");
    expect(describeCron("0 0 * * *")).toBe("every day at 00:00");
    expect(describeCron("30 9 * * *")).toBe("every day at 09:30");
  });

  it("falls back to the expression itself rather than guessing", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("0 9 * * 1-5");
  });

  it("describes a spec the same way the workflow list will", () => {
    expect(describeSchedule({ mode: "every", everyMinutes: 2 })).toBe("every 2 min");
    expect(describeSchedule({ mode: "cron", cron: "0 * * * *" })).toBe("every hour");
  });
});
