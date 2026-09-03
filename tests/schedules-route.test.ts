import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/schedules`, with Clerk, Convex and the Workflow SDK replaced.
 *
 * The route is now a thin adapter: publishing is the switch users press (`publishWorkflow` in
 * `app/(app)/w/[workflowId]/actions.ts`), and this endpoint is kept for anything already calling
 * it. Both run the *same* `lib/schedules-server.ts` functions, so these tests are also the
 * end-to-end check that a request and a publish cannot disagree about what enabling means —
 * `tests/schedules-server.test.ts` covers the same functions from the other side.
 *
 * What is under test is therefore the decision plus its HTTP dress — who may enable a schedule, on
 * what interval, what happens to the run that was already sleeping on it, and which status each
 * refusal earns — not Convex or the SDK. Clerk Billing is not switched on yet, so `has()` answers
 * false for everybody here too: the free path (an hourly schedule on `free_org`) is the one the
 * phase check actually walks.
 *
 * Factories rather than automocks: `@/lib/engine-client` pulls in the workflow definitions and
 * `@/workflows/scheduler` pulls in the step files, none of which a route test should load.
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

const {
  getScheduleForWorkflow,
  getWorkflowForRun,
  setScheduleEnabled,
  setScheduleRunId,
  upsertSchedule,
} = vi.hoisted(() => ({
  getScheduleForWorkflow: vi.fn(),
  getWorkflowForRun: vi.fn(),
  setScheduleEnabled: vi.fn(),
  setScheduleRunId: vi.fn(),
  upsertSchedule: vi.fn(),
}));
vi.mock("@/lib/engine-client", () => ({
  getScheduleForWorkflow,
  getWorkflowForRun,
  setScheduleEnabled,
  setScheduleRunId,
  upsertSchedule,
}));

const { start, getRun, cancel } = vi.hoisted(() => {
  const cancel = vi.fn();
  return { cancel, start: vi.fn(), getRun: vi.fn(() => ({ cancel })) };
});
vi.mock("workflow/api", () => ({ start, getRun }));

const { scheduler } = vi.hoisted(() => ({ scheduler: vi.fn() }));
vi.mock("@/workflows/scheduler", () => ({ scheduler }));

const { POST } = await import("@/app/api/schedules/route");

const WORKFLOW_ID = "wf_123";
const SCHEDULE_ID = "sch_1";

/** A saved graph whose trigger is a Schedule node with these inputs. */
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
    name: "Flow",
    webhookSecret: "s".repeat(32),
  };
}

function post(body: unknown): Request {
  return new Request("https://app.test/api/schedules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
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
  setScheduleRunId.mockResolvedValue(undefined);
  setScheduleEnabled.mockResolvedValue(undefined);
  start.mockResolvedValue({ runId: "wrun_new" });
  cancel.mockResolvedValue(undefined);
});

describe("POST /api/schedules — who may ask", () => {
  it("refuses an unauthenticated caller with 401 and starts nothing", async () => {
    auth.mockResolvedValue({ isAuthenticated: false, orgId: null, has: () => false });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
    expect(start).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
  });

  it("refuses a signed-in user with no active organisation", async () => {
    auth.mockResolvedValue({ isAuthenticated: true, orgId: null, has: () => false });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(401);
    expect(getScheduleForWorkflow).not.toHaveBeenCalled();
  });

  it("answers 404 for a workflow id Convex will not even accept as one", async () => {
    getScheduleForWorkflow.mockRejectedValue(
      new Error("ArgumentValidationError: Value does not match validator"),
    );

    const response = await POST(post({ workflowId: "definitely-not-an-id", action: "enable" }));

    expect(response.status).toBe(404);
    expect(start).not.toHaveBeenCalled();
  });

  it("answers 502 rather than 404 when the store itself is unreachable", async () => {
    getScheduleForWorkflow.mockRejectedValue(new Error("fetch failed"));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "upstream_error" });
  });

  it("refuses a body that is not one, or an action it does not have", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ workflowId: WORKFLOW_ID, action: "delete" }))).status).toBe(400);
    expect((await POST(post({ action: "enable" }))).status).toBe(400);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("POST /api/schedules — enable", () => {
  it("refuses a sub-hourly schedule on the free plan with 403 and a message that says why", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 2 }));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("too_frequent");
    expect(body.error).toMatch(/hour/);
    expect(body.error).toMatch(/2 min/);

    expect(upsertSchedule).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("enables an hourly schedule on the free plan and starts the scheduler", async () => {
    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      unchanged: false,
      scheduleId: SCHEDULE_ID,
      cron: "0 * * * *",
      timezone: "UTC",
      runId: "wrun_new",
    });

    // The row is written first, because its id is the scheduler run's only argument…
    expect(upsertSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_1",
        workflowId: WORKFLOW_ID,
        cron: "0 * * * *",
        timezone: "UTC",
        enabled: true,
      }),
    );
    // …then the run starts on the current deployment (only the handover asks for "latest")…
    expect(start).toHaveBeenCalledWith(
      scheduler,
      [{ scheduleId: SCHEDULE_ID, cron: "0 * * * *", timezone: "UTC" }],
      { attributes: { scheduleId: SCHEDULE_ID, orgId: "org_1" } },
    );
    // …and only then does the row learn which run to cancel when someone presses pause.
    expect(setScheduleRunId).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      runId: "wrun_new",
    });
  });

  it("stores a fire time the scheduler and the canvas agree on", async () => {
    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));
    const body = (await response.json()) as { nextAt: number | null };

    const [args] = upsertSchedule.mock.calls[0] as [{ nextAt?: number }];
    expect(args.nextAt).toBe(body.nextAt);
    expect(args.nextAt).toBeGreaterThan(Date.now());
    // Hourly, so the next one is at most an hour away and lands exactly on the hour.
    expect(args.nextAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(new Date(args.nextAt!).getUTCMinutes()).toBe(0);
  });

  it("lets a two-minute schedule through on a paid plan", async () => {
    signedIn({ sessionClaims: { pla: "o:pro" } });
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 2 }));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, cron: "*/2 * * * *" });
  });

  it("lets the schedules feature lift the interval floor for an org whose plan claim lags", async () => {
    signedIn({ has: (params: { feature?: string }) => params.feature === "org:schedules" });
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 5 }));

    expect((await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }))).status).toBe(200);
  });

  it("reads the interval from the saved graph, never from the request body", async () => {
    const response = await POST(
      post({ workflowId: WORKFLOW_ID, action: "enable", everyMinutes: 1, cron: "* * * * *" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cron: "0 * * * *" });
  });

  it("answers 404 for a workflow that is not this organisation's", async () => {
    getWorkflowForRun.mockResolvedValue(null);

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(404);
    expect(start).not.toHaveBeenCalled();
  });

  it("refuses a graph with no Schedule trigger in it", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith(null));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "no_schedule_trigger" });
  });

  it("refuses a Schedule trigger nobody has configured yet", async () => {
    // `parseScheduleInputs` refuses it, which is a different code from a bad expression: there is
    // nothing to correct, only something to fill in.
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "cron" }));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_cron" });
    expect(start).not.toHaveBeenCalled();
  });

  it("refuses an expression that is not a cron with 400 rather than 403", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "cron", cron: "every tuesday" }));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_cron" });
    expect(start).not.toHaveBeenCalled();
  });

  it("leaves an unchanged, already-running schedule alone rather than delaying it", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 * * * *",
      timezone: "UTC",
      enabled: true,
      runId: "wrun_existing",
      nextAt: 1_800_000,
      updatedAt: 1,
    });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      unchanged: true,
      runId: "wrun_existing",
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
  });

  it("cancels the sleeping run and starts a new one when the cron has changed", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 0 * * *",
      timezone: "UTC",
      enabled: true,
      runId: "wrun_old",
      updatedAt: 1,
    });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(getRun).toHaveBeenCalledWith("wrun_old");
    expect(cancel).toHaveBeenCalledWith({ cancelReason: expect.stringContaining(WORKFLOW_ID) });
    expect(start).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ unchanged: false, runId: "wrun_new" });
  });

  it("starts the new run even when cancelling the old one fails", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 0 * * *",
      timezone: "UTC",
      enabled: false,
      runId: "wrun_gone",
      updatedAt: 1,
    });
    cancel.mockRejectedValue(new Error("run not found"));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/schedules — pause", () => {
  it("cancels the sleeping run and disables the row", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 * * * *",
      timezone: "UTC",
      enabled: true,
      runId: "wrun_sleeping",
      updatedAt: 1,
    });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "pause" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, scheduled: true });

    expect(getRun).toHaveBeenCalledWith("wrun_sleeping");
    expect(cancel).toHaveBeenCalledWith({ cancelReason: expect.stringContaining(WORKFLOW_ID) });
    expect(setScheduleEnabled).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      enabled: false,
    });
    // Pausing never touches the graph, so it never has to read it.
    expect(getWorkflowForRun).not.toHaveBeenCalled();
  });

  it("is a 200 when there is nothing to pause, so the switch can be clicked twice", async () => {
    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "pause" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, scheduled: false });
    expect(cancel).not.toHaveBeenCalled();
    expect(setScheduleEnabled).not.toHaveBeenCalled();
  });

  it("still disables the row when the run has already gone", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 * * * *",
      timezone: "UTC",
      enabled: true,
      runId: "wrun_gone",
      updatedAt: 1,
    });
    cancel.mockRejectedValue(new Error("run not found"));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "pause" }));

    expect(response.status).toBe(200);
    expect(setScheduleEnabled).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      enabled: false,
    });
  });
});
