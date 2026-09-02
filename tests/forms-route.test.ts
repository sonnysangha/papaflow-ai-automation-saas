import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/forms/[workflowId]/route";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * The hosted form's submit endpoint, with the engine and Clerk replaced: what is under test is the
 * public contract (a submission in, a run out) rather than Convex or billing.
 *
 * Factories rather than automocks, like `tests/hooks-route.test.ts`: `@/lib/engine-client` pulls in
 * the workflow definitions and the Workflow SDK, none of which a route test should load. The rate
 * limiter and the node definition are the real ones — they are the two things this route is made of.
 */
const { getPublicForm, getWorkflowPublic, startRun, getOrgPlan } = vi.hoisted(() => ({
  getPublicForm: vi.fn(),
  getWorkflowPublic: vi.fn(),
  startRun: vi.fn(),
  getOrgPlan: vi.fn(),
}));

vi.mock("@/lib/engine-client", () => ({ getPublicForm, getWorkflowPublic, startRun }));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));

const WORKFLOW_ID = "wf_123";

/** What the canvas saved for the form trigger node, as `getPublicForm` hands it back. */
const FORM = {
  title: "Contact us",
  description: "We answer within a day.",
  fields: [
    { name: "email", label: "Email", type: "email", required: true },
    { name: "message", label: "Message", type: "textarea", required: true },
    { name: "topic", label: "Topic", type: "select", required: false, options: ["sales", "help"] },
  ],
  submitLabel: "Send",
};

/** The route's second argument: Next hands dynamic segments over as a promise. */
function context(workflowId: string = WORKFLOW_ID) {
  return { params: Promise.resolve({ workflowId }) };
}

/** One submission from `ip` — a distinct IP per test, so the rate limiter never crosses tests. */
function submit(values: unknown, ip = "203.0.113.1"): Request {
  return new Request(`https://app.test/api/forms/${WORKFLOW_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 70.41.3.18` },
    body: JSON.stringify({ values }),
  });
}

beforeEach(() => {
  resetRateLimit();
  getPublicForm.mockReset();
  getWorkflowPublic.mockReset();
  startRun.mockReset();
  getOrgPlan.mockReset();

  getPublicForm.mockResolvedValue({ name: "Contact form", form: FORM });
  getWorkflowPublic.mockResolvedValue({
    orgId: "org_1",
    webhookSecret: "s".repeat(32),
    hasTrigger: { webhook: false, form: true },
  });
  startRun.mockResolvedValue({ executionId: "ex_1", runId: "run_1" });
  getOrgPlan.mockResolvedValue("pro");
});

describe("POST /api/forms/[workflowId]", () => {
  it("answers 404 for a workflow that has no published form", async () => {
    getPublicForm.mockResolvedValue(null);

    const response = await POST(submit({ email: "a@b.com", message: "hi" }), context("wf_nope"));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a value the form's own schema rejects, naming the field", async () => {
    const response = await POST(
      submit({ email: "not-an-email", message: "hi" }, "203.0.113.2"),
      context(),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; error: string; fields: Record<string, string> };
    expect(body.code).toBe("invalid_values");
    expect(body.fields).toHaveProperty("email");
    expect(body.error).toContain("email");
    expect(body.fields).not.toHaveProperty("message");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a missing required field", async () => {
    const response = await POST(submit({ email: "a@b.com", message: "  " }, "203.0.113.3"), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "invalid_values",
      fields: { message: "Message is required." },
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("starts a form run and answers 202", async () => {
    const before = Date.now();
    const response = await POST(
      submit({ email: "a@b.com", message: "hello there", topic: "sales" }, "203.0.113.4"),
      context(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });

    expect(startRun).toHaveBeenCalledTimes(1);
    const call = startRun.mock.calls[0][0];
    expect(call).toMatchObject({
      orgId: "org_1",
      workflowId: WORKFLOW_ID,
      planSlug: "pro",
      trigger: {
        type: "form",
        payload: { values: { email: "a@b.com", message: "hello there", topic: "sales" } },
      },
    });
    expect(call.trigger.payload.submittedAt).toBeGreaterThanOrEqual(before);
    expect(getOrgPlan).toHaveBeenCalledWith("org_1");
  });

  it("keeps only the configured fields, and coerces the ones the spec types", async () => {
    getPublicForm.mockResolvedValue({
      name: "Signup",
      form: {
        title: "Sign up",
        fields: [{ name: "seats", label: "Seats", type: "number", required: true }],
        submitLabel: "Go",
      },
    });

    const response = await POST(
      submit({ seats: "12", isAdmin: true }, "203.0.113.5"),
      context(),
    );

    expect(response.status).toBe(202);
    expect(startRun.mock.calls[0][0].trigger.payload.values).toEqual({ seats: 12 });
  });

  it("refuses the eleventh submission from one IP inside a minute", async () => {
    const ip = "203.0.113.6";

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ok = await POST(submit({ email: "a@b.com", message: "hi" }, ip), context());
      expect(ok.status).toBe(202);
    }

    const blocked = await POST(submit({ email: "a@b.com", message: "hi" }, ip), context());
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: "rate_limited" });
    expect(startRun).toHaveBeenCalledTimes(10);

    // The window is per IP: a different visitor is unaffected.
    const other = await POST(submit({ email: "a@b.com", message: "hi" }, "203.0.113.7"), context());
    expect(other.status).toBe(202);
  });
});
