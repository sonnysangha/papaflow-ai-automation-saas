import { describe, expect, it } from "vitest";

import { isOpenRun, runStats, type StatsRun } from "@/components/runs/run-stats";

const NOW = 1_700_000_000_000;

/** A finished run of `ms`, `ago` milliseconds before `NOW`. */
function run(status: string, ago: number, ms?: number): StatsRun {
  const startedAt = NOW - ago;
  return { status, startedAt, finishedAt: ms === undefined ? undefined : startedAt + ms };
}

describe("runStats", () => {
  it("has no rate and no average when nothing has finished", () => {
    const stats = runStats([run("running", 5_000), run("queued", 1_000)], NOW);

    expect(stats.total).toBe(2);
    expect(stats.finished).toBe(0);
    expect(stats.successRate).toBeNull();
    expect(stats.avgDurationMs).toBeNull();
  });

  it("is empty rather than NaN for no runs at all", () => {
    expect(runStats([], NOW)).toMatchObject({
      total: 0,
      finished: 0,
      active: 0,
      successRate: null,
      avgDurationMs: null,
      oldestActiveMs: null,
    });
  });

  it("rates completions against every finished run, cancellations included", () => {
    const stats = runStats(
      [
        run("completed", 60_000, 1_000),
        run("completed", 50_000, 3_000),
        run("failed", 40_000, 500),
        run("cancelled", 30_000, 200),
      ],
      NOW,
    );

    expect(stats.finished).toBe(4);
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.successRate).toBe(50);
  });

  it("rounds the rate to a whole percent", () => {
    const stats = runStats(
      [run("completed", 3, 1), run("completed", 2, 1), run("failed", 1, 1)],
      NOW,
    );

    expect(stats.successRate).toBe(67);
  });

  it("averages completed runs only — a failure or a run still going never moves it", () => {
    const stats = runStats(
      [
        run("completed", 60_000, 1_000),
        run("completed", 50_000, 3_000),
        // A failure that stopped early, and a run with no end at all.
        run("failed", 40_000, 10),
        run("running", 30_000),
      ],
      NOW,
    );

    expect(stats.avgDurationMs).toBe(2_000);
  });

  it("counts everything still open as active, and how long the oldest has been going", () => {
    const stats = runStats(
      [
        run("running", 30_000),
        run("waiting", 90_000),
        run("queued", 1_000),
        run("completed", 10_000, 500),
      ],
      NOW,
    );

    expect(stats.active).toBe(3);
    expect(stats.running).toBe(1);
    expect(stats.waiting).toBe(1);
    expect(stats.queued).toBe(1);
    expect(stats.oldestActiveMs).toBe(90_000);
  });

  it("has no oldest-active time when every run has finished", () => {
    expect(runStats([run("completed", 10_000, 500)], NOW).oldestActiveMs).toBeNull();
  });

  it("treats a completed run with no end as instant rather than negative", () => {
    expect(runStats([{ status: "completed", startedAt: NOW }], NOW).avgDurationMs).toBe(0);
  });
});

describe("isOpenRun", () => {
  it("is true for the three states a run can still leave", () => {
    expect(["queued", "running", "waiting"].every(isOpenRun)).toBe(true);
    expect(["completed", "failed", "cancelled"].some(isOpenRun)).toBe(false);
  });
});
