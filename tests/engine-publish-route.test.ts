import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/engine/publish` — the door the Builder's `finish` knocks on.
 *
 * It exists because publishing is not a status write. A Schedule trigger's "on" is the workflow's
 * `status` *and* a durable Convex job armed for the next occurrence (`convex/schedules.ts`), and
 * only the Next app can decide that — so while `finish` published through a Convex mutation, a
 * schedule-triggered workflow the Builder built was live in the canvas and never fired. What is
 * under test here is that the route is the *same* publish the button performs
 * (`lib/publish-server.ts`), wearing a doorman: a constant-time secret check, an org that travels in
 * the body rather than being assumed, and a status code the agent can tell apart — 4xx is the
 * model's to act on, 401 and 5xx end its turn.
 *
 * Convex and Clerk's billing read are replaced; the schedule maths (`lib/schedule.ts`) is not,
 * because "would this fire more often than the plan allows?" is half of what is being tested. A
 * factory rather than an automock: `@/lib/engine-client` pulls in the workflow definitions a route
 * test has no business loading.
 */
const { getOrgPlan } = vi.hoisted(() => ({ getOrgPlan: vi.fn() }));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));

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

process.env.ENGINE_SECRET = "engine-secret";

const { POST } = await import("@/app/api/engine/publish/route");

const WORKFLOW_ID = "wf_123";
const SCHEDULE_ID = "sch_1";

const BODY = { workflowId: WORKFLOW_ID, orgId: "org_1", userId: "user_1", publish: true };

function post(body: unknown, secret: string | null = "engine-secret"): Request {
  return new Request("https://app.test/api/engine/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { authorization: `Bearer ${secret}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

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
    status: "draft" as const,
    webhookSecret: "s".repeat(32),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  process.env.ENGINE_SECRET = "engine-secret";
  // No session out here, so the plan is whatever Clerk's Backend API says (CLAUDE.md rule 10).
  getOrgPlan.mockResolvedValue("free_org");
  getScheduleForWorkflow.mockResolvedValue(null);
  getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 60 }));
  upsertSchedule.mockResolvedValue(SCHEDULE_ID);
  armSchedule.mockResolvedValue(undefined);
  disarmSchedule.mockResolvedValue(undefined);
  setWorkflowStatus.mockResolvedValue(undefined);
});

describe("POST /api/engine/publish — who may ask", () => {
  it("refuses a missing, wrong or malformed bearer token", async () => {
    for (const request of [post(BODY, null), post(BODY, ""), post(BODY, "engine-secre")]) {
      const response = await POST(request);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthorized" });
    }
    expect(getWorkflowForRun).not.toHaveBeenCalled();
    expect(setWorkflowStatus).not.toHaveBeenCalled();
  });

  it("refuses everything when the deployment has no ENGINE_SECRET at all", async () => {
    delete process.env.ENGINE_SECRET;
    const response = await POST(post(BODY, "anything"));
    expect(response.status).toBe(500);
    expect(setWorkflowStatus).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a workflow, an org and a decision", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ workflowId: WORKFLOW_ID, orgId: "org_1" }))).status).toBe(400);
    expect((await POST(post({ orgId: "org_1", publish: true }))).status).toBe(400);
    expect((await POST(post({ ...BODY, publish: "yes" }))).status).toBe(400);
    expect(setWorkflowStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/engine/publish — publishing", () => {
  it("arms the schedule and publishes, in that order, on the plan Clerk reports", async () => {
    const response = await POST(post(BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "active",
      scheduled: true,
      nextAt: expect.any(Number),
    });

    expect(getOrgPlan).toHaveBeenCalledWith("org_1");
    expect(upsertSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org_1", workflowId: WORKFLOW_ID, enabled: true }),
    );
    expect(armSchedule).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      orgId: "org_1",
      nextAt: expect.any(Number),
    });
    expect(setWorkflowStatus).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      status: "active",
    });
    // Schedule first: a plan that refuses the interval must leave the workflow unpublished.
    expect(armSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      setWorkflowStatus.mock.invocationCallOrder[0],
    );
  });

  it("publishes a workflow with no Schedule trigger without arming anything", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith(null));

    const response = await POST(post(BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "active", scheduled: false, nextAt: null });
    expect(setWorkflowStatus).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      status: "active",
    });
    expect(armSchedule).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
    expect(disarmSchedule).not.toHaveBeenCalled();
  });

  it("unpublishes, then disarms whatever Convex job was armed for the schedule", async () => {
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

    const response = await POST(post({ ...BODY, publish: false }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "paused", scheduled: false, nextAt: null });
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
});

describe("POST /api/engine/publish — refusals the agent can act on", () => {
  it("answers 400 too_frequent and leaves the workflow unpublished", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 2 }));

    const response = await POST(post(BODY));

    // 400 rather than the browser route's 403: the Builder reads 4xx as "yours to fix" and can
    // slow the schedule down, while 5xx and 401 end its turn.
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("too_frequent");
    expect(body.error).toMatch(/hour/);
    expect(body.error).toMatch(/2 min/);

    expect(setWorkflowStatus).not.toHaveBeenCalled();
    expect(upsertSchedule).not.toHaveBeenCalled();
    expect(armSchedule).not.toHaveBeenCalled();
  });

  it("lets the same schedule through once the org is on a paid plan", async () => {
    getOrgPlan.mockResolvedValue("pro");
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: 2 }));

    const response = await POST(post(BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "active", scheduled: true });
  });

  it("answers 404 for a workflow that is not this organisation's", async () => {
    getWorkflowForRun.mockResolvedValue(null);

    const response = await POST(post(BODY));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
    expect(setWorkflowStatus).not.toHaveBeenCalled();
    expect(armSchedule).not.toHaveBeenCalled();
  });

  it("answers 400 for a Schedule trigger whose configuration is not one", async () => {
    getWorkflowForRun.mockResolvedValue(graphWith({ mode: "every", everyMinutes: "hourly" }));

    const response = await POST(post(BODY));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_schedule" });
    expect(setWorkflowStatus).not.toHaveBeenCalled();
  });

  it("answers 502 rather than 404 when the schedule store itself is unreachable", async () => {
    getScheduleForWorkflow.mockRejectedValue(new Error("fetch failed"));

    const response = await POST(post(BODY));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "upstream_error" });
    expect(setWorkflowStatus).not.toHaveBeenCalled();
  });

  it("answers 500 without echoing the shared secret when something else breaks", async () => {
    getWorkflowForRun.mockRejectedValue(new Error("unauthorized: secret=engine-secret"));

    const response = await POST(post(BODY));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ code: "publish_failed" });
    expect(JSON.stringify(body)).not.toContain("engine-secret");
  });
});
