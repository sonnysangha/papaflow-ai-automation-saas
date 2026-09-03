import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/engine/schedule-tick` — the door Convex's alarm clock (`convex/schedules.ts#fire`)
 * knocks on.
 *
 * This is where every decision about a tick actually lives: Convex carries nothing but the tick's
 * identity (`scheduleId`, `workflowId`, `orgId`, `plannedAt`), and this route re-reads the schedule
 * and the workflow fresh, decides whether the tick may go on to start a run, and hands back
 * instructions Convex reads to decide what happens to the alarm next — 200 to record and re-arm,
 * 409 to disarm, anything else to retry and eventually fall back.
 *
 * `@/lib/engine-client` is faked: it imports `runGraph` and every step file, which a route test has
 * no business loading. The schedule maths (`lib/schedule.ts#nextFireTime`) is not, because "when
 * does this fire next" is half of what a 200 response has to get right.
 */
const { getOrgPlan } = vi.hoisted(() => ({ getOrgPlan: vi.fn() }));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));

const { getSchedule, getWorkflowForRun, startRun } = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  getWorkflowForRun: vi.fn(),
  startRun: vi.fn(),
}));
vi.mock("@/lib/engine-client", () => ({ getSchedule, getWorkflowForRun, startRun }));

process.env.ENGINE_SECRET = "engine-secret";

const { POST } = await import("@/app/api/engine/schedule-tick/route");

function post(body: unknown, secret: string | null = "engine-secret"): Request {
  return new Request("https://app.test/api/engine/schedule-tick", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { authorization: `Bearer ${secret}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SCHEDULE_ID = "sch_1";
const WORKFLOW_ID = "wf_1";
const PLANNED_AT = 1_800_000;
const BODY = { scheduleId: SCHEDULE_ID, workflowId: WORKFLOW_ID, orgId: "org_1", plannedAt: PLANNED_AT };

/** A `schedules` row, as `getSchedule` hands it back. */
function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: SCHEDULE_ID,
    orgId: "org_1",
    workflowId: WORKFLOW_ID,
    cron: "0 * * * *",
    timezone: "UTC",
    enabled: true,
    jobId: "job_1",
    nextAt: PLANNED_AT,
    plannedAt: PLANNED_AT,
    updatedAt: 1,
    ...overrides,
  };
}

/** A workflow, as `getWorkflowForRun` hands it back. */
function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    graph: { nodes: [], edges: [] },
    version: 1,
    name: "Nightly digest",
    status: "active" as const,
    webhookSecret: "s".repeat(32),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENGINE_SECRET = "engine-secret";

  getSchedule.mockResolvedValue(scheduleRow());
  getWorkflowForRun.mockResolvedValue(workflowRow());
  getOrgPlan.mockResolvedValue("free_org");
  startRun.mockResolvedValue({ executionId: "exec_1", runId: "run_1" });
});

describe("POST /api/engine/schedule-tick — who may ask", () => {
  it("refuses a missing, wrong or malformed bearer token", async () => {
    for (const request of [post(BODY, null), post(BODY, ""), post(BODY, "engine-secre")]) {
      const response = await POST(request);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthorized" });
    }
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses everything when the deployment has no ENGINE_SECRET at all", async () => {
    delete process.env.ENGINE_SECRET;
    const response = await POST(post(BODY, "anything"));
    expect(response.status).toBe(500);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a schedule tick", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ scheduleId: SCHEDULE_ID }))).status).toBe(400);
    expect((await POST(post({ ...BODY, plannedAt: "soon" }))).status).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
  });
});

describe("POST /api/engine/schedule-tick — not_published", () => {
  it("refuses a schedule Convex no longer knows about", async () => {
    getSchedule.mockResolvedValue(null);

    const response = await POST(post(BODY));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "not_published" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("answers 404, not 500, for an id Convex rejects before any handler runs", async () => {
    // What `ConvexHttpClient` surfaces when `v.id("schedules")` refuses the string — a probe with a
    // made-up id, never a tick Convex itself sent. A 500 here would have Convex retry three times
    // and arm a fallback for a row that cannot exist.
    getSchedule.mockRejectedValue(
      new Error(
        '[Request ID: abc] Server Error\nArgumentValidationError: Value does not match validator.\nPath: .scheduleId\nValue: "bogus"\nValidator: v.id("schedules")',
      ),
    );

    const response = await POST(post({ ...BODY, scheduleId: "bogus" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a schedule that has been disarmed since Convex's own check", async () => {
    getSchedule.mockResolvedValue(scheduleRow({ enabled: false }));

    const response = await POST(post(BODY));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "not_published" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a schedule whose workflowId or orgId does not match the body Convex sent", async () => {
    getSchedule.mockResolvedValue(scheduleRow({ workflowId: "wf_someone_elses" }));
    expect((await POST(post(BODY))).status).toBe(409);

    getSchedule.mockResolvedValue(scheduleRow({ orgId: "org_someone_elses" }));
    expect((await POST(post(BODY))).status).toBe(409);

    expect(startRun).not.toHaveBeenCalled();
  });

  it.each(["draft", "paused"] as const)(
    "refuses a workflow that is not published (%s)",
    async (status) => {
      getWorkflowForRun.mockResolvedValue(workflowRow({ status }));

      const response = await POST(post(BODY));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "not_published" });
      expect(startRun).not.toHaveBeenCalled();
    },
  );

  it("refuses a workflow that has been deleted", async () => {
    getWorkflowForRun.mockResolvedValue(null);

    const response = await POST(post(BODY));

    expect(response.status).toBe(409);
    expect(startRun).not.toHaveBeenCalled();
  });
});

describe("POST /api/engine/schedule-tick — starting the run", () => {
  it("starts the run with the plan Clerk reports, and hands back the next occurrence", async () => {
    const response = await POST(post(BODY));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { started: boolean; executionId: string; nextAt: number };
    expect(body.started).toBe(true);
    expect(body.executionId).toBe("exec_1");
    // Hourly, so the next occurrence is at most an hour away and lands exactly on the hour.
    expect(body.nextAt).toBeGreaterThan(Date.now());
    expect(body.nextAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(new Date(body.nextAt).getUTCMinutes()).toBe(0);

    expect(getOrgPlan).toHaveBeenCalledWith("org_1");
    expect(startRun).toHaveBeenCalledWith({
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      trigger: {
        type: "schedule",
        // ISO, matching `nodes/triggers/schedule.ts#scheduleTriggerNode`'s declared `firedAt`
        // output — a template already reading `{{ trigger.firedAt }}` keeps working.
        payload: { firedAt: new Date(PLANNED_AT).toISOString(), scheduleId: SCHEDULE_ID },
      },
      planSlug: "free_org",
    });
  });

  it("computes the next occurrence from now, not from the stale plannedAt", async () => {
    getSchedule.mockResolvedValue(scheduleRow({ cron: "*/2 * * * *" }));

    const response = await POST(post({ ...BODY, plannedAt: 1 }));
    const body = (await response.json()) as { nextAt: number };

    // `plannedAt: 1` is 1970 — if `nextAt` were computed from it, this would be nowhere near now.
    expect(body.nextAt).toBeGreaterThan(Date.now());
    expect(body.nextAt).toBeLessThanOrEqual(Date.now() + 120_000);
  });

  it("swallows run_limit into a 200 that keeps the chain ticking", async () => {
    startRun.mockRejectedValue(new Error("run_limit"));

    const response = await POST(post(BODY));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { started: boolean; reason?: string; nextAt: number };
    expect(body).toMatchObject({ started: false, reason: "run_limit" });
    expect(body.nextAt).toEqual(expect.any(Number));
  });

  it("answers 500 for a failure the org cannot fix by itself, so Convex retries the tick", async () => {
    startRun.mockRejectedValue(new Error("Convex is down"));

    const response = await POST(post(BODY));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "tick_failed" });
  });

  it("never echoes the shared secret back, whatever the failure said", async () => {
    startRun.mockRejectedValue(new Error("unauthorized: secret=engine-secret"));

    const response = await POST(post(BODY));

    expect(JSON.stringify(await response.json())).not.toContain("engine-secret");
  });
});
