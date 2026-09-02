import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/builder/session` and its `PATCH`, with Clerk and Convex replaced.
 *
 * What is under test is the decision the route makes — who may open a Builder chat, against which
 * workflow — not Convex. This is layer two of the plan gate (CLAUDE.md rule 3): the panel's
 * `<Show>` only hides the wall, and the tools check the plan again inside `execute`.
 *
 * Factories rather than automocks: `@/lib/builder-engine` reaches Convex through the generated API,
 * which a route test has no business loading.
 */
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth }));

const { attachEveSession, getBuilderWorkflow, startBuilderSession } = vi.hoisted(() => ({
  attachEveSession: vi.fn(),
  getBuilderWorkflow: vi.fn(),
  startBuilderSession: vi.fn(),
}));
vi.mock("@/lib/builder-engine", () => ({
  attachEveSession,
  getBuilderWorkflow,
  startBuilderSession,
  builderErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const { POST, PATCH } = await import("@/app/api/builder/session/route");

const WORKFLOW_ID = "wf_123";

function post(body: unknown): Request {
  return new Request("https://app.test/api/builder/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function patch(body: unknown): Request {
  return new Request("https://app.test/api/builder/session", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A signed-in member of an organisation whose plan Clerk says includes the feature. */
function signedIn({ builder = true }: { builder?: boolean } = {}) {
  auth.mockResolvedValue({
    isAuthenticated: true,
    orgId: "org_1",
    userId: "user_1",
    has: vi.fn((check: { feature?: string }) => builder && check.feature === "org:ai_builder"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getBuilderWorkflow.mockResolvedValue({
    name: "Flow",
    status: "draft",
    version: 3,
    graph: { nodes: [], edges: [] },
  });
  startBuilderSession.mockResolvedValue({ builderSessionId: "bs_1", eveSessionId: "" });
  attachEveSession.mockResolvedValue(undefined);
});

describe("POST /api/builder/session", () => {
  it("401s without a session or without an active organisation", async () => {
    auth.mockResolvedValue({ isAuthenticated: false, orgId: null, userId: null, has: vi.fn() });
    const response = await POST(post({ workflowId: WORKFLOW_ID }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });

    auth.mockResolvedValue({
      isAuthenticated: true,
      orgId: null,
      userId: "user_1",
      has: vi.fn(() => true),
    });
    expect((await POST(post({ workflowId: WORKFLOW_ID }))).status).toBe(401);
    expect(startBuilderSession).not.toHaveBeenCalled();
  });

  it("403s an organisation whose plan does not include the builder", async () => {
    signedIn({ builder: false });
    const response = await POST(post({ workflowId: WORKFLOW_ID }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "upgrade_required",
      feature: "ai_builder",
      error: "The AI builder is a Pro feature.",
    });
    expect(getBuilderWorkflow).not.toHaveBeenCalled();
  });

  it("checks the feature with Clerk's explicit org: prefix", async () => {
    signedIn();
    await POST(post({ workflowId: WORKFLOW_ID }));

    const { has } = await auth.mock.results[0].value;
    expect(has).toHaveBeenCalledWith({ feature: "org:ai_builder" });
  });

  it("400s a body that is not the one shape it accepts", async () => {
    signedIn();
    expect((await POST(post("not json at all"))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
  });

  it("404s a workflow that is not this organisation's", async () => {
    signedIn();
    getBuilderWorkflow.mockResolvedValue(null);

    const response = await POST(post({ workflowId: WORKFLOW_ID }));
    expect(response.status).toBe(404);
    expect(startBuilderSession).not.toHaveBeenCalled();
  });

  it("opens the session and answers with the row the panel keys its chat on", async () => {
    signedIn();
    const response = await POST(post({ workflowId: WORKFLOW_ID }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      builderSessionId: "bs_1",
      eveSessionId: "",
      workflow: { name: "Flow", version: 3, status: "draft" },
    });
    expect(startBuilderSession).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      orgId: "org_1",
      userId: "user_1",
    });
  });

  it("hands back the eve session id of an open chat so a reload resumes it", async () => {
    signedIn();
    startBuilderSession.mockResolvedValue({ builderSessionId: "bs_1", eveSessionId: "wrun_9" });

    const body = (await (await POST(post({ workflowId: WORKFLOW_ID }))).json()) as {
      eveSessionId: string;
    };
    expect(body.eveSessionId).toBe("wrun_9");
  });

  it("500s rather than leaking a Convex failure as a success", async () => {
    signedIn();
    startBuilderSession.mockRejectedValue(new Error("convex is down"));

    const response = await POST(post({ workflowId: WORKFLOW_ID }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "server_error" });
  });
});

describe("PATCH /api/builder/session", () => {
  it("records the eve session id against the caller's own row", async () => {
    signedIn();
    const response = await PATCH(patch({ builderSessionId: "bs_1", eveSessionId: "wrun_1" }));

    expect(response.status).toBe(200);
    expect(attachEveSession).toHaveBeenCalledWith({
      builderSessionId: "bs_1",
      eveSessionId: "wrun_1",
      orgId: "org_1",
      userId: "user_1",
    });
  });

  it("is gated exactly like the POST", async () => {
    auth.mockResolvedValue({ isAuthenticated: false, orgId: null, userId: null, has: vi.fn() });
    expect((await PATCH(patch({ builderSessionId: "bs_1", eveSessionId: "x" }))).status).toBe(401);

    signedIn({ builder: false });
    expect((await PATCH(patch({ builderSessionId: "bs_1", eveSessionId: "x" }))).status).toBe(403);

    signedIn();
    expect((await PATCH(patch({ builderSessionId: "bs_1" }))).status).toBe(400);
    expect(attachEveSession).not.toHaveBeenCalled();
  });
});
