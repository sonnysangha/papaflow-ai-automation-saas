import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/engine/run` — the door the Builder's `run_workflow` knocks on.
 *
 * It exists because a workflow function is only a workflow after the Workflow SDK's compiler has
 * transformed it, and that happens in the Next build rather than in the agent's own Vercel service
 * (`docs/research/eve-spike.md`, Phase 12 addendum item 5). So what is under test here is the
 * doorman: a constant-time secret check, an org that travels in the body rather than being assumed,
 * and a status code the agent can tell apart — 4xx is the model's to act on, 401 and 5xx end its
 * turn.
 *
 * `@/lib/engine-client` is faked: it imports `runGraph` and every step file, which a route test has
 * no business loading.
 */
const { startRun } = vi.hoisted(() => ({ startRun: vi.fn() }));
vi.mock("@/lib/engine-client", () => ({ startRun }));

const { getOrgPlan } = vi.hoisted(() => ({ getOrgPlan: vi.fn() }));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));

process.env.ENGINE_SECRET = "engine-secret";

const { POST } = await import("@/app/api/engine/run/route");

function post(body: unknown, secret: string | null = "engine-secret"): Request {
  return new Request("https://app.test/api/engine/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { authorization: `Bearer ${secret}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const BODY = { workflowId: "wf_1", orgId: "org_1", userId: "user_1", payload: { name: "Sam" } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENGINE_SECRET = "engine-secret";
  getOrgPlan.mockResolvedValue("pro");
  startRun.mockResolvedValue({ executionId: "exec_1", runId: "run_1" });
});

describe("POST /api/engine/run", () => {
  it("starts the run the Run button would start, with the plan Clerk reports", async () => {
    const response = await POST(post(BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ executionId: "exec_1", runId: "run_1" });
    expect(getOrgPlan).toHaveBeenCalledWith("org_1");
    expect(startRun).toHaveBeenCalledWith({
      orgId: "org_1",
      workflowId: "wf_1",
      trigger: { type: "manual", payload: { name: "Sam" } },
      startedBy: "user_1",
      planSlug: "pro",
    });
  });

  it("starts with an empty payload when none was sent, so the trigger's sample takes over", async () => {
    await POST(post({ workflowId: "wf_1", orgId: "org_1" }));
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: { type: "manual", payload: {} }, startedBy: undefined }),
    );
  });

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

  it("refuses a body that is not a workflow and an org", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({ workflowId: "wf_1" }))).status).toBe(400);
    expect((await POST(post({ orgId: "org_1" }))).status).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("answers 400 for the failures the agent can act on and 500 for the ones it cannot", async () => {
    startRun.mockRejectedValueOnce(new Error("workflow not found"));
    expect((await POST(post(BODY))).status).toBe(400);

    startRun.mockRejectedValueOnce(new Error("run_limit"));
    const limited = await POST(post(BODY));
    expect(limited.status).toBe(400);
    expect(await limited.json()).toMatchObject({ code: "run_failed", error: "run_limit" });

    startRun.mockRejectedValueOnce(new Error("Convex is down"));
    expect((await POST(post(BODY))).status).toBe(500);
  });

  it("never echoes the shared secret back, whatever the failure said", async () => {
    startRun.mockRejectedValueOnce(new Error("unauthorized: secret=engine-secret"));
    const response = await POST(post(BODY));
    expect(JSON.stringify(await response.json())).not.toContain("engine-secret");
  });
});
