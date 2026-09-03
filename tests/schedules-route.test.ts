import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/schedules`, with Clerk and Convex replaced.
 *
 * The route is now a thin adapter: publishing is the switch users press (`publishWorkflow` in
 * `app/(app)/w/[workflowId]/actions.ts`), and this endpoint is kept for anything already calling
 * it. Both run the *same* `lib/schedules-server.ts` functions, so these tests are also the
 * end-to-end check that a request and a publish cannot disagree about what enabling means —
 * `tests/schedules-server.test.ts` covers the same functions from the other side.
 *
 * What is under test is therefore the decision plus its HTTP dress — who may enable a schedule, on
 * what interval, what happens to the Convex job that was already armed for it, and which status
 * each refusal earns — not Convex itself. Clerk Billing is not switched on yet, so `has()` answers
 * false for everybody here too: the free path (an hourly schedule on `free_org`) is the one the
 * phase check actually walks.
 *
 * A factory rather than an automock: `@/lib/engine-client` pulls in the workflow definitions a
 * route test has no business loading.
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

const { armSchedule, disarmSchedule, getScheduleForWorkflow, getWorkflowForRun, upsertSchedule } =
  vi.hoisted(() => ({
    armSchedule: vi.fn(),
    disarmSchedule: vi.fn(),
    getScheduleForWorkflow: vi.fn(),
    getWorkflowForRun: vi.fn(),
    upsertSchedule: vi.fn(),
  }));
vi.mock("@/lib/engine-client", () => ({
  armSchedule,
  disarmSchedule,
  getScheduleForWorkflow,
  getWorkflowForRun,
  upsertSchedule,
}));

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
  armSchedule.mockResolvedValue(undefined);
  disarmSchedule.mockResolvedValue(undefined);
});

describe("POST /api/schedules — who may ask", () => {
  it("refuses an unauthenticated caller with 401 and starts nothing", async () => {
    auth.mockResolvedValue({ isAuthenticated: false, orgId: null, has: () => false });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
    expect(armSchedule).not.toHaveBeenCalled();
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
    expect(armSchedule).not.toHaveBeenCalled();
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
    expect(armSchedule).not.toHaveBeenCalled();
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
    expect(armSchedule).not.toHaveBeenCalled();
  });

  it("enables an hourly schedule on the free plan and arms the Convex job", async () => {
    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      unchanged: false,
      scheduleId: SCHEDULE_ID,
      cron: "0 * * * *",
      timezone: "UTC",
    });

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
    // …and only then is the Convex job armed against the id that write just produced.
    expect(armSchedule).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      nextAt: expect.any(Number),
    });
  });

  it("stores a fire time the Convex job and the canvas agree on", async () => {
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
    expect(armSchedule).not.toHaveBeenCalled();
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
    expect(armSchedule).not.toHaveBeenCalled();
  });

  it("refuses an expression that is not a cron with 400 rather than 403", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "cron", cron: "every tuesday" }));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_cron" });
    expect(armSchedule).not.toHaveBeenCalled();
  });

  it("leaves an unchanged, already-armed schedule alone rather than delaying it", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 * * * *",
      timezone: "UTC",
      enabled: true,
      jobId: "job_existing",
      nextAt: 1_800_000,
      updatedAt: 1,
    });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      unchanged: true,
      nextAt: 1_800_000,
    });
    expect(armSchedule).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
  });

  it("re-arms the Convex job when the cron has changed", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 0 * * *",
      timezone: "UTC",
      enabled: true,
      jobId: "job_old",
      updatedAt: 1,
    });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    // Cancelling whatever was armed for the old cron is Convex's job now (`arm` in
    // `convex/schedules.ts`, exercised in `convex/schedules.test.ts`) — from here, all this route
    // can see is that a fresh job was armed for the new occurrence.
    expect(armSchedule).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ unchanged: false, cron: "0 * * * *" });
  });

  it("arms the job for a row that was previously disabled", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 0 * * *",
      timezone: "UTC",
      enabled: false,
      jobId: undefined,
      updatedAt: 1,
    });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "enable" }));

    expect(response.status).toBe(200);
    expect(armSchedule).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/schedules — pause", () => {
  it("disarms the Convex job and disables the row", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 * * * *",
      timezone: "UTC",
      enabled: true,
      jobId: "job_sleeping",
      updatedAt: 1,
    });

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "pause" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, scheduled: true });

    expect(disarmSchedule).toHaveBeenCalledWith({ scheduleId: SCHEDULE_ID, orgId: "org_1" });
    // Pausing never touches the graph, so it never has to read it.
    expect(getWorkflowForRun).not.toHaveBeenCalled();
  });

  it("is a 200 when there is nothing to pause, so the switch can be clicked twice", async () => {
    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "pause" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, scheduled: false });
    expect(disarmSchedule).not.toHaveBeenCalled();
  });

  it("answers 502 rather than throw when Convex cannot be reached to disarm", async () => {
    getScheduleForWorkflow.mockResolvedValue({
      _id: SCHEDULE_ID,
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      cron: "0 * * * *",
      timezone: "UTC",
      enabled: true,
      jobId: "job_sleeping",
      updatedAt: 1,
    });
    disarmSchedule.mockRejectedValue(new Error("fetch failed"));

    const response = await POST(post({ workflowId: WORKFLOW_ID, action: "pause" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "upstream_error" });
  });
});
