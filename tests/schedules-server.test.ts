import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Publishing a workflow, and what that does to its schedule.
 *
 * This is the bug the module exists to fix: publishing a workflow whose trigger was a Schedule did
 * nothing at all, because starting the schedule was a *second* switch in the config panel. The
 * `schedules` table stayed empty while the canvas said "Published". So what is under test here is
 * the decision — who may enable a schedule, on what interval, in which order the two writes happen,
 * and what is left behind when one of them refuses.
 *
 * Convex is the alarm clock now (`convex/schedules.ts`): enabling a schedule arms a durable Convex
 * job instead of starting a Workflow SDK run, and pausing disarms it. `@/lib/engine-client` is
 * replaced with a factory so these tests never load the workflow definitions it pulls in; the
 * schedule maths (`lib/schedule.ts`) is not, because "would this fire more often than the plan
 * allows?" is the answer being tested.
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

const {
  armSchedule,
  disarmSchedule,
  getScheduleForWorkflow,
  getWorkflowForRun,
  setWorkflowStatus,
  upsertSchedule,
} = vi.hoisted(() => ({
  armSchedule: vi.fn(),
  disarmSchedule: vi.fn(),
  getScheduleForWorkflow: vi.fn(),
  getWorkflowForRun: vi.fn(),
  setWorkflowStatus: vi.fn(),
  upsertSchedule: vi.fn(),
}));
vi.mock("@/lib/engine-client", () => ({
  armSchedule,
  disarmSchedule,
  getScheduleForWorkflow,
  getWorkflowForRun,
  setWorkflowStatus,
  upsertSchedule,
}));

const {
  enableSchedule,
  hasScheduleTrigger,
  pauseSchedule,
  publishDecision,
  schedulePlan,
} = await import("@/lib/schedules-server");
const { publishWorkflow } = await import("@/app/(app)/w/[workflowId]/actions");

const WORKFLOW_ID = "wf_123";
const SCHEDULE_ID = "sch_1";

/** A saved graph whose trigger is a Schedule node with these inputs, or a Manual one when null. */
function graphWith(inputs: Record<string, unknown> | null) {
  return {
    graph: {
      nodes:
        inputs === null
          ? [{ id: "n1", data: { nodeType: "manual.trigger", inputs: {} } }]
          : [{ id: "n1", data: { nodeType: "schedule.trigger", inputs } }],
      edges: [],
      triggerId: "n1",
    },
    version: 1,
    name: "Hourly endpoint check",
    status: "paused" as const,
    webhookSecret: "s".repeat(32),
  };
}

/** An existing `schedules` row, as `getScheduleForWorkflow` hands it back. */
function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: SCHEDULE_ID,
    orgId: "org_1",
    workflowId: WORKFLOW_ID,
    cron: "0 * * * *",
    timezone: "UTC",
    enabled: true,
    jobId: "job_sleeping",
    updatedAt: 1,
    ...overrides,
  };
}

/** The signed-in default: a free organisation, no Clerk features (Billing is not on yet). */
function signedIn(overrides: Record<string, unknown> = {}) {
  auth.mockResolvedValue({
    isAuthenticated: true,
    orgId: "org_1",
    userId: "user_1",
    sessionClaims: {},
    has: () => false,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  signedIn();
  getScheduleForWorkflow.mockResolvedValue(null);
  getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 60 }));
  upsertSchedule.mockResolvedValue(SCHEDULE_ID);
  armSchedule.mockResolvedValue(undefined);
  disarmSchedule.mockResolvedValue(undefined);
  setWorkflowStatus.mockResolvedValue(undefined);
});

describe("publishDecision — what Publish means", () => {
  it("publishing a Schedule trigger starts the schedule", () => {
    expect(publishDecision({ publish: true, scheduleTrigger: true })).toEqual({
      status: "active",
      schedule: "enable",
    });
  });

  it("unpublishing always pauses it", () => {
    expect(publishDecision({ publish: false, scheduleTrigger: true })).toEqual({
      status: "paused",
      schedule: "pause",
    });
    expect(publishDecision({ publish: false, scheduleTrigger: false })).toEqual({
      status: "paused",
      schedule: "pause",
    });
  });

  it("publishing a graph with no Schedule trigger pauses a schedule left over from one", () => {
    // A row belonging to a trigger the user has since replaced must never fire its replacement.
    expect(publishDecision({ publish: true, scheduleTrigger: false })).toEqual({
      status: "active",
      schedule: "pause",
    });
  });
});

describe("hasScheduleTrigger — reading the saved graph", () => {
  it("finds a Schedule trigger and nothing else", () => {
    expect(hasScheduleTrigger(graphWith({ mode: "every", everyMinutes: 60 }).graph)).toBe(true);
    expect(hasScheduleTrigger(graphWith(null).graph)).toBe(false);
  });

  it("survives a graph that is not one — `workflows.graph` is v.any()", () => {
    expect(hasScheduleTrigger(null)).toBe(false);
    expect(hasScheduleTrigger({})).toBe(false);
    expect(hasScheduleTrigger({ nodes: "not an array" })).toBe(false);
    expect(hasScheduleTrigger({ nodes: [null, { data: null }, {}] })).toBe(false);
  });
});

describe("schedulePlan — which plan the interval is judged against", () => {
  it("uses the org's own plan, and `pro` once the schedules feature is held", () => {
    expect(schedulePlan({ plan: "free_org", entitled: false })).toBe("free_org");
    expect(schedulePlan({ plan: "free_org", entitled: true })).toBe("pro");
  });
});

describe("enableSchedule", () => {
  it("writes the row, then arms the Convex job for the first occurrence", async () => {
    const result = await enableSchedule({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      userId: "user_1",
      plan: "free_org",
    });

    expect(result).toMatchObject({ ok: true, unchanged: false, cron: "0 * * * *" });
    expect(result.ok && result.nextAt).toEqual(expect.any(Number));

    // The row is written first, because its id is the job's only real argument…
    expect(upsertSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_1",
        workflowId: WORKFLOW_ID,
        cron: "0 * * * *",
        timezone: "UTC",
        enabled: true,
      }),
    );
    // …and only then is the job armed against the id that write just produced.
    expect(armSchedule).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      nextAt: expect.any(Number),
    });
  });

  it("refuses an interval the plan will not run, and writes nothing", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 2 }));

    const result = await enableSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1", plan: "free_org" });

    expect(result).toMatchObject({ ok: false, code: "too_frequent" });
    expect(result.ok === false && result.error).toMatch(/hour/);
    expect(upsertSchedule).not.toHaveBeenCalled();
    expect(armSchedule).not.toHaveBeenCalled();
  });

  it("reads the graph the caller already has rather than fetching it twice", async () => {
    await enableSchedule({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      plan: "free_org",
      workflow: graphWith({ mode: "every", everyMinutes: 60 }),
    });

    expect(getWorkflowForRun).not.toHaveBeenCalled();
    expect(armSchedule).toHaveBeenCalledTimes(1);
  });

  it("leaves an unchanged, already-armed schedule alone rather than delaying it", async () => {
    getScheduleForWorkflow.mockResolvedValue(scheduleRow({ jobId: "job_existing", nextAt: 1_800_000 }));

    const result = await enableSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1", plan: "free_org" });

    expect(result).toMatchObject({ ok: true, unchanged: true, nextAt: 1_800_000 });
    expect(armSchedule).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
  });

  it("answers not_found for a workflow that is not this organisation's", async () => {
    getWorkflowForRun.mockResolvedValue(null);

    expect(await enableSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1", plan: "free_org" })).toMatchObject(
      { ok: false, code: "not_found" },
    );
    expect(armSchedule).not.toHaveBeenCalled();
  });

  it("tells a malformed id from an unreachable store", async () => {
    getScheduleForWorkflow.mockRejectedValueOnce(
      new Error("ArgumentValidationError: Value does not match validator"),
    );
    expect(await enableSchedule({ workflowId: "nope", orgId: "org_1", plan: "free_org" })).toMatchObject({
      ok: false,
      code: "not_found",
    });

    getScheduleForWorkflow.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await enableSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1", plan: "free_org" })).toMatchObject(
      { ok: false, code: "upstream_error" },
    );
  });
});

describe("pauseSchedule", () => {
  it("disarms the Convex job", async () => {
    getScheduleForWorkflow.mockResolvedValue(scheduleRow());

    expect(await pauseSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1" })).toMatchObject({
      ok: true,
      scheduled: true,
    });

    expect(disarmSchedule).toHaveBeenCalledWith({ scheduleId: SCHEDULE_ID, orgId: "org_1" });
  });

  it("is a success when there is nothing to pause, so Publish can be pressed twice", async () => {
    expect(await pauseSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1" })).toMatchObject({
      ok: true,
      scheduled: false,
    });
    expect(disarmSchedule).not.toHaveBeenCalled();
  });

  it("is idempotent by construction: disarming an already-gone job is Convex's problem, not this one's", async () => {
    // `convex/schedules.ts#disarm` tolerates a job that has already fired or been cancelled on its
    // own (unlike the old design, where cancelling a *finished* Workflow SDK run had to be caught
    // here) — so a call that resolves at all, whatever state the job was actually in, is a success.
    getScheduleForWorkflow.mockResolvedValue(scheduleRow({ jobId: "job_gone" }));

    expect(await pauseSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1" })).toMatchObject({ ok: true });
    expect(disarmSchedule).toHaveBeenCalledWith({ scheduleId: SCHEDULE_ID, orgId: "org_1" });
  });

  it("answers upstream_error rather than throw when Convex cannot be reached", async () => {
    getScheduleForWorkflow.mockResolvedValue(scheduleRow());
    disarmSchedule.mockRejectedValue(new Error("fetch failed"));

    expect(await pauseSchedule({ workflowId: WORKFLOW_ID, orgId: "org_1" })).toMatchObject({
      ok: false,
      code: "upstream_error",
    });
  });
});

describe("publishWorkflow — one switch", () => {
  it("arms the schedule and publishes, in that order", async () => {
    const result = await publishWorkflow(WORKFLOW_ID, true);

    expect(result).toEqual({
      ok: true,
      status: "active",
      scheduled: true,
      nextAt: expect.any(Number),
    });
    expect(setWorkflowStatus).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      status: "active",
    });
    // Schedule first: a plan that refuses the interval must leave the workflow unpublished, and a
    // job armed a beat early cannot fire, because `/api/engine/schedule-tick` refuses a workflow
    // that is not `active` yet.
    expect(armSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      setWorkflowStatus.mock.invocationCallOrder[0],
    );
  });

  it("leaves the workflow unpublished when the plan refuses the interval", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 2 }));

    const result = await publishWorkflow(WORKFLOW_ID, true);

    expect(result).toMatchObject({ ok: false, code: "too_frequent" });
    expect(result.ok === false && result.error).toMatch(/Upgrade/);
    expect(setWorkflowStatus).not.toHaveBeenCalled();
    expect(armSchedule).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
  });

  it("lets a two-minute schedule through on a paid plan", async () => {
    signedIn({ sessionClaims: { pla: "o:pro" } });
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 2 }));

    expect(await publishWorkflow(WORKFLOW_ID, true)).toMatchObject({ ok: true, scheduled: true });
    expect(armSchedule).toHaveBeenCalledTimes(1);
  });

  it("lets the schedules feature lift the interval floor", async () => {
    signedIn({ has: (params: { feature?: string }) => params.feature === "org:schedules" });
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 5 }));

    expect(await publishWorkflow(WORKFLOW_ID, true)).toMatchObject({ ok: true, scheduled: true });
  });

  it("unpublishes first, then pauses the schedule", async () => {
    getScheduleForWorkflow.mockResolvedValue(scheduleRow());

    expect(await publishWorkflow(WORKFLOW_ID, false)).toEqual({
      ok: true,
      status: "paused",
      scheduled: false,
      nextAt: null,
    });

    expect(setWorkflowStatus).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      status: "paused",
    });
    expect(disarmSchedule).toHaveBeenCalledWith({ scheduleId: SCHEDULE_ID, orgId: "org_1" });
    // Status first: it alone already stops every trigger, so an unreachable schedule store can
    // never be the reason a workflow stays live.
    expect(setWorkflowStatus.mock.invocationCallOrder[0]).toBeLessThan(
      disarmSchedule.mock.invocationCallOrder[0],
    );
  });

  it("unpublishes even when the schedule cannot be paused", async () => {
    getScheduleForWorkflow.mockRejectedValue(new Error("fetch failed"));

    expect(await publishWorkflow(WORKFLOW_ID, false)).toMatchObject({ ok: true, status: "paused" });
    expect(setWorkflowStatus).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      status: "paused",
    });
  });

  it("leaves a workflow with no Schedule trigger alone but for its status", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith(null));

    expect(await publishWorkflow(WORKFLOW_ID, true)).toEqual({
      ok: true,
      status: "active",
      scheduled: false,
      nextAt: null,
    });

    expect(setWorkflowStatus).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      status: "active",
    });
    expect(armSchedule).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
    expect(disarmSchedule).not.toHaveBeenCalled();
  });

  it("answers not_found for a workflow that is not this organisation's", async () => {
    getWorkflowForRun.mockResolvedValue(null);

    expect(await publishWorkflow(WORKFLOW_ID, true)).toMatchObject({ ok: false, code: "not_found" });
    expect(setWorkflowStatus).not.toHaveBeenCalled();
  });

  it("refuses a caller with no organisation before it reads anything", async () => {
    auth.mockResolvedValue({ isAuthenticated: false, orgId: null, has: () => false });

    await expect(publishWorkflow(WORKFLOW_ID, true)).rejects.toThrow(/unauthorized/);
    expect(getWorkflowForRun).not.toHaveBeenCalled();
    expect(setWorkflowStatus).not.toHaveBeenCalled();
  });
});
