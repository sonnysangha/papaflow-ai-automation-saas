import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduler's steps: the only part of Phase 9 that decides whether a workflow actually runs.
 *
 * `computeNext` and `fireSchedule` are `"use step"` functions, which under vitest are just async
 * functions — the directive is a compiler instruction, not runtime behaviour — so what is exercised
 * here is exactly the logic the SDK would call, with Convex and Clerk replaced.
 *
 * The case worth the most: a step must be safe to re-run (CLAUDE.md rule 7). `fireSchedule` claims
 * the tick before it starts anything, so a retry — which the SDK will do on any thrown error —
 * cannot start the workflow a second time for the same tick.
 */
const { getSchedule, markScheduleFired, setScheduleRunId, startRun } = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  markScheduleFired: vi.fn(),
  setScheduleRunId: vi.fn(),
  startRun: vi.fn(),
}));
vi.mock("@/lib/engine-client", () => ({
  getSchedule,
  markScheduleFired,
  setScheduleRunId,
  startRun,
}));

const { getOrgPlan } = vi.hoisted(() => ({ getOrgPlan: vi.fn() }));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));

const { computeNext, fireSchedule, storeSchedulerRun } = await import(
  "@/workflows/steps/schedule-steps"
);

const SCHEDULE_ID = "sch_1";
const HOURLY = "0 * * * *";

/** 08:30 UTC on a Tuesday; the hourly tick after it is 09:00. */
const TICK = Date.parse("2026-09-02T09:00:00.000Z");

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: SCHEDULE_ID,
    orgId: "org_1",
    workflowId: "wf_1",
    cron: HOURLY,
    timezone: "UTC",
    enabled: true,
    runId: "wrun_sleeping",
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  getSchedule.mockResolvedValue(scheduleRow());
  getOrgPlan.mockResolvedValue("free_org");
  startRun.mockResolvedValue({ executionId: "ex_1", runId: "wrun_graph" });
  markScheduleFired.mockResolvedValue(undefined);
  setScheduleRunId.mockResolvedValue(undefined);
});

describe("computeNext", () => {
  it("reads the real clock — which is the whole reason it is a step", async () => {
    const before = Date.now();
    const next = await computeNext(HOURLY, "UTC");

    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(before);
    expect(new Date(next!).getUTCMinutes()).toBe(0);
  });

  it("answers null when the expression will never fire, so the run can stop", async () => {
    expect(await computeNext("not a cron")).toBeNull();
  });
});

describe("fireSchedule", () => {
  it("claims the tick, then starts the workflow with the plan Clerk reports", async () => {
    const fired = await fireSchedule({
      scheduleId: SCHEDULE_ID,
      cron: HOURLY,
      timezone: "UTC",
      firedAt: TICK,
    });

    expect(fired).toBe(true);

    expect(markScheduleFired).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      firedAt: TICK,
      nextAt: Date.parse("2026-09-02T10:00:00.000Z"),
    });
    expect(getOrgPlan).toHaveBeenCalledWith("org_1");
    expect(startRun).toHaveBeenCalledWith({
      orgId: "org_1",
      workflowId: "wf_1",
      planSlug: "free_org",
      trigger: {
        type: "schedule",
        payload: { firedAt: "2026-09-02T09:00:00.000Z", scheduleId: SCHEDULE_ID },
      },
    });

    // The tick is claimed before the run is started: a crash in between loses one tick, which is
    // the failure worth having.
    expect(markScheduleFired.mock.invocationCallOrder[0]).toBeLessThan(
      startRun.mock.invocationCallOrder[0],
    );
  });

  it("starts nothing a second time when a retry replays a tick that was already claimed", async () => {
    getSchedule.mockResolvedValue(scheduleRow({ lastFiredAt: TICK }));

    expect(
      await fireSchedule({ scheduleId: SCHEDULE_ID, cron: HOURLY, timezone: "UTC", firedAt: TICK }),
    ).toBe(true);

    expect(startRun).not.toHaveBeenCalled();
    expect(markScheduleFired).not.toHaveBeenCalled();
  });

  it("still fires a later tick after an earlier one was claimed", async () => {
    getSchedule.mockResolvedValue(scheduleRow({ lastFiredAt: TICK - 3_600_000 }));

    expect(
      await fireSchedule({ scheduleId: SCHEDULE_ID, cron: HOURLY, timezone: "UTC", firedAt: TICK }),
    ).toBe(true);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("returns false for a paused schedule, which is how the sleeping run ends itself", async () => {
    getSchedule.mockResolvedValue(scheduleRow({ enabled: false }));

    expect(
      await fireSchedule({ scheduleId: SCHEDULE_ID, cron: HOURLY, timezone: "UTC", firedAt: TICK }),
    ).toBe(false);
    expect(startRun).not.toHaveBeenCalled();
    expect(markScheduleFired).not.toHaveBeenCalled();
  });

  it("returns false when the schedule (or its workflow) has been deleted", async () => {
    getSchedule.mockResolvedValue(null);

    expect(
      await fireSchedule({ scheduleId: SCHEDULE_ID, cron: HOURLY, timezone: "UTC", firedAt: TICK }),
    ).toBe(false);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("survives a refused run — an org over its monthly limit must not kill the schedule", async () => {
    startRun.mockRejectedValue(new Error("run_limit"));

    expect(
      await fireSchedule({ scheduleId: SCHEDULE_ID, cron: HOURLY, timezone: "UTC", firedAt: TICK }),
    ).toBe(true);
    // The tick is still consumed, so the next one is scheduled and the chain carries on.
    expect(markScheduleFired).toHaveBeenCalledTimes(1);
  });
});

describe("storeSchedulerRun", () => {
  it("points the row at the run that took over, so Pause still cancels the right one", async () => {
    await storeSchedulerRun(SCHEDULE_ID, "wrun_second");

    expect(setScheduleRunId).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      runId: "wrun_second",
    });
  });

  it("writes nothing when the schedule has gone in the meantime", async () => {
    getSchedule.mockResolvedValue(null);

    await storeSchedulerRun(SCHEDULE_ID, "wrun_second");

    expect(setScheduleRunId).not.toHaveBeenCalled();
  });
});
