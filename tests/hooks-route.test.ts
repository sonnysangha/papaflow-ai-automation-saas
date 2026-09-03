import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/hooks/[workflowId]/[secret]/route";

/**
 * The Webhook trigger route, with the engine and Clerk replaced: what is under test is the URL
 * contract (secret in, payload out) rather than Convex or billing.
 *
 * Factories rather than automocks: `@/lib/engine-client` pulls in the workflow definitions and the
 * Workflow SDK, none of which a route test should load.
 */
const { getWorkflowPublic, startRun, getOrgPlan } = vi.hoisted(() => ({
  getWorkflowPublic: vi.fn(),
  startRun: vi.fn(),
  getOrgPlan: vi.fn(),
}));

vi.mock("@/lib/engine-client", () => ({ getWorkflowPublic, startRun }));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));

const WORKFLOW_ID = "wf_123";
const SECRET = "a".repeat(32);
const OTHER_SECRET = "b".repeat(32);

/** The route's second argument: Next hands dynamic segments over as a promise. */
function context(secret: string = SECRET) {
  return { params: Promise.resolve({ workflowId: WORKFLOW_ID, secret }) };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.test/api/hooks/${WORKFLOW_ID}/${SECRET}?source=crm`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getWorkflowPublic.mockReset();
  startRun.mockReset();
  getOrgPlan.mockReset();

  getWorkflowPublic.mockResolvedValue({
    orgId: "org_1",
    status: "active",
    webhookSecret: SECRET,
    hasTrigger: { webhook: true, form: false },
  });
  startRun.mockResolvedValue({ executionId: "ex_1", runId: "run_1" });
  getOrgPlan.mockResolvedValue("pro");
});

describe("POST /api/hooks/[workflowId]/[secret]", () => {
  it("starts a run and answers 202 with the execution id", async () => {
    const response = await POST(
      post({ hello: "world" }, { authorization: "Bearer nope", cookie: "session=nope" }),
      context(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ executionId: "ex_1" });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith({
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      planSlug: "pro",
      trigger: {
        type: "webhook",
        payload: {
          method: "POST",
          headers: { "content-type": "application/json" },
          query: { source: "crm" },
          body: { hello: "world" },
        },
      },
    });
    expect(getOrgPlan).toHaveBeenCalledWith("org_1");
  });

  it("refuses a wrong secret with 404 and starts nothing", async () => {
    const response = await POST(post({ hello: "world" }), context(OTHER_SECRET));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("answers the same 404 for a workflow that does not exist", async () => {
    getWorkflowPublic.mockResolvedValue(null);

    const response = await POST(post({}), context());

    expect(response.status).toBe(404);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a workflow whose graph has no webhook trigger", async () => {
    getWorkflowPublic.mockResolvedValue({
      orgId: "org_1",
      status: "active",
      webhookSecret: SECRET,
      hasTrigger: { webhook: false, form: true },
    });

    const response = await POST(post({}), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "no_webhook_trigger" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it.each(["draft", "paused"] as const)("refuses a %s workflow and starts nothing", async (status) => {
    // The URL is right and the trigger is there — the workflow just has not been published, which
    // is a state the sender can wait out, so 409 rather than the 404 a wrong secret gets.
    getWorkflowPublic.mockResolvedValue({
      orgId: "org_1",
      status,
      webhookSecret: SECRET,
      hasTrigger: { webhook: true, form: false },
    });

    const response = await POST(post({ hello: "world" }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "not_published",
      error: "This workflow is not published yet.",
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("keeps a non-JSON body as text", async () => {
    const request = new Request(`https://app.test/api/hooks/${WORKFLOW_ID}/${SECRET}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "ping",
    });

    expect((await POST(request, context())).status).toBe(202);
    expect(startRun.mock.calls[0][0].trigger.payload).toMatchObject({
      body: "ping",
      query: {},
    });
  });

  it("reports a failed start as a 5xx without leaking the cause", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    startRun.mockRejectedValue(new Error("convex exploded: secret-ish detail"));

    const response = await POST(post({}), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "run_failed",
      error: "Could not start this workflow.",
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("GET /api/hooks/[workflowId]/[secret]", () => {
  it("starts a run with a null body and the query string", async () => {
    const request = new Request(
      `https://app.test/api/hooks/${WORKFLOW_ID}/${SECRET}?email=a%40b.com&plan=pro`,
    );

    const response = await GET(request, context());

    expect(response.status).toBe(202);
    expect(startRun.mock.calls[0][0].trigger.payload).toMatchObject({
      method: "GET",
      body: null,
      query: { email: "a@b.com", plan: "pro" },
    });
  });
});
