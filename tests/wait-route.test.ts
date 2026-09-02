import { beforeEach, describe, expect, it, vi } from "vitest";
import { HookNotFoundError } from "workflow/errors";

import { POST } from "@/app/api/wait/[token]/route";

/**
 * The Wait-for-webhook resume route and the `resumeByToken` plumbing under it, with Convex and the
 * Workflow SDK's dispatcher replaced: what is under test is the contract (token in, payload
 * through, 200 or 404 out) rather than either of those.
 *
 * `HookNotFoundError` is the real class, not a stub — the whole point of the mapping is that the
 * SDK's own error becomes a 404, and `.is()` is what does it.
 *
 * Factories rather than automocks: `@/lib/engine-client` pulls in the workflow definitions, which
 * a route test should not load.
 */
const { getStepByHookToken, resumeHook } = vi.hoisted(() => ({
  getStepByHookToken: vi.fn(),
  resumeHook: vi.fn(),
}));

vi.mock("@/lib/engine-client", () => ({ getStepByHookToken }));
vi.mock("workflow/api", () => ({ resumeHook }));

const EXECUTION_ID = "ex_123";
const NODE_ID = "wait_1";
const TOKEN = `${EXECUTION_ID}:${NODE_ID}`;

/** The route's second argument: Next hands dynamic segments over as a promise. */
function context(token: string = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.test/api/wait/${encodeURIComponent(TOKEN)}`, {
    method: "POST",
    headers,
    body,
  });
}

const WAITING_STEP = {
  _id: "st_1",
  executionId: EXECUTION_ID,
  orgId: "org_1",
  nodeId: NODE_ID,
  nodeType: "logic.waitForWebhook",
  status: "waiting",
};

beforeEach(() => {
  getStepByHookToken.mockReset();
  resumeHook.mockReset();

  getStepByHookToken.mockResolvedValue(WAITING_STEP);
  resumeHook.mockResolvedValue({ runId: "run_1" });
});

describe("POST /api/wait/[token]", () => {
  it("resumes the waiting run with the parsed body and the request's headers", async () => {
    const response = await POST(
      post(JSON.stringify({ approved: true }), {
        "content-type": "application/json",
        "x-source": "ci",
        authorization: "Bearer nope",
        cookie: "session=nope",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resumed: true });

    expect(getStepByHookToken).toHaveBeenCalledWith(TOKEN);
    expect(resumeHook).toHaveBeenCalledTimes(1);
    const [token, payload] = resumeHook.mock.calls[0] as [string, Record<string, unknown>];
    expect(token).toBe(TOKEN);
    expect(payload.body).toEqual({ approved: true });
    // Credentials never reach a step's output, which is stored and displayed (CLAUDE.md rule 1).
    expect(payload.headers).toMatchObject({ "content-type": "application/json", "x-source": "ci" });
    expect(payload.headers).not.toHaveProperty("authorization");
    expect(payload.headers).not.toHaveProperty("cookie");
  });

  it("keeps a non-JSON body as text, and an empty body as null", async () => {
    await POST(post("hello there", { "content-type": "text/plain" }), context());
    expect((resumeHook.mock.calls[0] as [string, { body: unknown }])[1].body).toBe("hello there");

    resumeHook.mockClear();
    await POST(post("", { "content-type": "application/json" }), context());
    expect((resumeHook.mock.calls[0] as [string, { body: unknown }])[1].body).toBeNull();

    // A body that claims JSON but is not stays as text rather than failing the delivery.
    resumeHook.mockClear();
    await POST(post("{not json", { "content-type": "application/json" }), context());
    expect((resumeHook.mock.calls[0] as [string, { body: unknown }])[1].body).toBe("{not json");
  });

  it("answers 404 without touching the SDK when no step carries the token", async () => {
    getStepByHookToken.mockResolvedValue(null);

    const response = await POST(post("{}", { "content-type": "application/json" }), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_waiting" });
    expect(resumeHook).not.toHaveBeenCalled();
  });

  it("answers the same 404 for a step that has stopped waiting", async () => {
    for (const status of ["success", "failed", "running", "skipped"]) {
      getStepByHookToken.mockResolvedValue({ ...WAITING_STEP, status });

      const response = await POST(post("{}", { "content-type": "application/json" }), context());
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_waiting" });
    }
    expect(resumeHook).not.toHaveBeenCalled();
  });

  it("maps the SDK's HookNotFoundError onto the same 404 (the run ended mid-flight)", async () => {
    resumeHook.mockRejectedValue(new HookNotFoundError(TOKEN));

    const response = await POST(post("{}", { "content-type": "application/json" }), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_waiting" });
  });

  it("reports any other failure as a 502 rather than pretending nothing was waiting", async () => {
    resumeHook.mockRejectedValue(new Error("queue dispatch failed"));

    const response = await POST(post("{}", { "content-type": "application/json" }), context());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "resume_failed" });
  });
});
