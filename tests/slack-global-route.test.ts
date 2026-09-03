import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as slackPost } from "@/app/api/events/slack/route";

/**
 * `POST /api/events/slack` — the one Slack endpoint, with Convex, the vault and the hook plumbing
 * replaced.
 *
 * The thing this route has to get right is the thing the per-connection route never had to: it is
 * handed a workspace id by a stranger and must turn it into *the* connection that can prove the
 * delivery. So the tests below are mostly about what happens when it cannot — an unknown workspace,
 * a signature made with the wrong secret, a connection with no signing secret at all — and one of
 * them is about the row that was created before `connections.externalId` existed and is only
 * findable through `meta.team_id`.
 *
 * Deliberately left real: `lib/signatures/slack.ts` (the signatures are computed here exactly as
 * Slack computes them) and `lib/inbound.ts#loadConnection`, so the two endpoints cannot drift apart
 * on which connections may receive a delivery.
 *
 * Factories rather than automocks: `@/lib/engine-client` pulls in the workflow definitions and the
 * Workflow SDK, none of which a route test should load.
 */
const {
  getConnectionSealed,
  listConnectionsByExternalId,
  listConnectionIdsByMeta,
  getWorkflowForRun,
  listWorkflowsByTrigger,
  startRun,
  updateConnectionMeta,
  getOrgPlan,
  open,
  resumeByStepId,
} = vi.hoisted(() => ({
  getConnectionSealed: vi.fn(),
  listConnectionsByExternalId: vi.fn(),
  listConnectionIdsByMeta: vi.fn(),
  getWorkflowForRun: vi.fn(),
  listWorkflowsByTrigger: vi.fn(),
  startRun: vi.fn(),
  updateConnectionMeta: vi.fn(),
  getOrgPlan: vi.fn(),
  open: vi.fn(),
  resumeByStepId: vi.fn(),
}));

vi.mock("@/lib/engine-client", () => ({
  getConnectionSealed,
  listConnectionsByExternalId,
  listConnectionIdsByMeta,
  getWorkflowForRun,
  listWorkflowsByTrigger,
  startRun,
  updateConnectionMeta,
}));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));
vi.mock("@/lib/vault", () => ({
  open,
  aadFor: (orgId: string, connectionId: string) => `${orgId}:${connectionId}`,
}));
vi.mock("@/lib/hooks", () => ({ resumeByStepId }));

const TEAM_ID = "T024BE7LD";
const APP_ID = "A0T0T0T0T";
const ORG_ID = "org_1";
const CONNECTION_ID = "cn_1";
const OTHER_CONNECTION_ID = "cn_2";
const OTHER_ORG_ID = "org_2";
const STEP_ID = "k17d9ab2c3e4f5g6h7i8j9k0l1m2n3o4";

const SIGNING_SECRET = "slack-signing-secret-abcdef0123456789";
const OTHER_SIGNING_SECRET = "another-orgs-signing-secret-0987654321";
const BOT_TOKEN = "xoxb-1111-2222-globalroutetokenabcd";

/** Every secret the route holds while it runs; none may appear in what it hands back. */
const SECRETS = [SIGNING_SECRET, OTHER_SIGNING_SECRET, BOT_TOKEN];

const RESUMED = {
  ok: true,
  executionId: "ex_1",
  nodeId: "approval_1",
  nodeType: "logic.approval",
  orgId: ORG_ID,
};

const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

/** A sealed row as `api.engine.getConnectionSealed` returns one — the ciphertext is never read. */
function sealedRow(connectionId: string) {
  return {
    orgId: connectionId === OTHER_CONNECTION_ID ? OTHER_ORG_ID : ORG_ID,
    provider: "slack",
    kind: "botToken",
    secret: { v: 1, keyId: "k1", iv: "iv", tag: "tag", ct: connectionId },
    status: "active",
    meta: { team_id: TEAM_ID },
  };
}

/** What `listConnectionsByExternalId` answers with: id, org, label, status — never a credential. */
function match(connectionId: string) {
  return {
    id: connectionId,
    orgId: connectionId === OTHER_CONNECTION_ID ? OTHER_ORG_ID : ORG_ID,
    label: "Acme",
    status: "active" as const,
  };
}

function request(
  rawBody: string,
  {
    timestamp = String(NOW_SECONDS()),
    secret = SIGNING_SECRET,
    contentType = "application/x-www-form-urlencoded",
    signature,
    signed = true,
  }: {
    timestamp?: string;
    secret?: string;
    contentType?: string;
    signature?: string;
    signed?: boolean;
  } = {},
): Request {
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");

  return new Request("https://app.test/api/events/slack", {
    method: "POST",
    headers: {
      "content-type": contentType,
      ...(signed
        ? {
            "x-slack-request-timestamp": timestamp,
            "x-slack-signature": signature ?? `v0=${digest}`,
          }
        : {}),
    },
    body: rawBody,
  });
}

/**
 * The form-encoded interactivity body Slack actually posts: one `payload` field holding the JSON,
 * with `team.id` and `api_app_id` on it (docs.slack.dev, block_actions payload).
 */
function blockActions(
  value: string,
  { username = "roadrunner", team = { id: TEAM_ID, domain: "acme" } as unknown } = {},
): string {
  const payload = {
    type: "block_actions",
    team,
    api_app_id: APP_ID,
    user: { id: "U2CERLKJA", username },
    container: { type: "message", message_ts: "1756800000.000100" },
    trigger_id: "13345224609.738474920.8b5bcc",
    actions: [
      {
        action_id: value.startsWith("approve") ? "approve" : "reject",
        block_id: "approval",
        type: "button",
        value,
        action_ts: "1756800001.000000",
      },
    ],
  };
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

/** Asserts that a response body — and anything handed to `resumeByStepId` — is secret-free. */
function expectNoSecrets(...values: unknown[]): void {
  const text = JSON.stringify(values);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrgPlan.mockResolvedValue("free_org");
  listWorkflowsByTrigger.mockResolvedValue([]);
  resumeByStepId.mockResolvedValue(RESUMED);

  // The happy path: one connection, found by the indexed workspace id.
  listConnectionsByExternalId.mockResolvedValue([match(CONNECTION_ID)]);
  listConnectionIdsByMeta.mockResolvedValue([]);
  getConnectionSealed.mockImplementation(async (connectionId: string) => sealedRow(connectionId));
  open.mockImplementation((sealed: { ct: string }) =>
    sealed.ct === OTHER_CONNECTION_ID
      ? { botToken: BOT_TOKEN, signingSecret: OTHER_SIGNING_SECRET }
      : { botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET },
  );
});

describe("POST /api/events/slack", () => {
  it("finds the connection by the workspace in the payload and resumes the run", async () => {
    const response = await slackPost(request(blockActions(`approve:${STEP_ID}`)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      replace_original: true,
      text: "✅ Approved by roadrunner",
    });

    // The lookup is by `team.id`, against the indexed column, for Slack only.
    expect(listConnectionsByExternalId).toHaveBeenCalledWith({
      provider: "slack",
      externalId: TEAM_ID,
    });
    // The index answered, so the legacy scan is never reached.
    expect(listConnectionIdsByMeta).not.toHaveBeenCalled();

    const [stepId, payload, orgId] = resumeByStepId.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(stepId).toBe(STEP_ID);
    expect(payload).toEqual({
      approved: true,
      by: "roadrunner",
      provider: "slack",
      handle: "approved",
    });
    // The org comes from the connection the press arrived on, never from the button.
    expect(orgId).toBe(ORG_ID);
  });

  it("resumes down `rejected` for the other button", async () => {
    const response = await slackPost(request(blockActions(`reject:${STEP_ID}`)));

    expect(await response.json()).toEqual({
      replace_original: true,
      text: "❌ Rejected by roadrunner",
    });
    expect((resumeByStepId.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      approved: false,
      handle: "rejected",
    });
  });

  it("is a 404 for a workspace no connection claims", async () => {
    listConnectionsByExternalId.mockResolvedValue([]);
    listConnectionIdsByMeta.mockResolvedValue([]);

    const response = await slackPost(request(blockActions(`approve:${STEP_ID}`)));

    expect(response.status).toBe(404);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: "not_found",
    });
    // Nothing was opened and nothing was resumed for a workspace we do not know.
    expect(getConnectionSealed).not.toHaveBeenCalled();
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("answers 401 for a forged signature, a stale timestamp and a missing header alike", async () => {
    const body = blockActions(`approve:${STEP_ID}`);

    const forged = await slackPost(request(body, { secret: "someone-elses-signing-secret" }));
    expect(forged.status).toBe(401);
    expect((await forged.json()) as Record<string, unknown>).toMatchObject({
      code: "bad_signature",
    });

    const stale = await slackPost(request(body, { timestamp: String(NOW_SECONDS() - 3600) }));
    expect(stale.status).toBe(401);

    const unsigned = await slackPost(request(body, { signed: false }));
    expect(unsigned.status).toBe(401);

    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("says so when the matched connection has no signing secret", async () => {
    open.mockReturnValue({ botToken: BOT_TOKEN });

    const response = await slackPost(request(blockActions(`approve:${STEP_ID}`)));

    expect(response.status).toBe(400);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: "no_signing_secret",
    });
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("echoes the url_verification challenge without needing a connection", async () => {
    // Slack's Events API URL check carries no workspace at all, so there is nothing to look up and
    // nothing to verify against — and nothing in the answer but the caller's own value.
    const body = JSON.stringify({
      type: "url_verification",
      token: "Jhj5dZrVaK7ZwHHjRyZWjbDl",
      challenge: "3eZbrw1aB",
    });

    const response = await slackPost(request(body, { contentType: "application/json" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "3eZbrw1aB" });
    expect(listConnectionsByExternalId).not.toHaveBeenCalled();
    expect(getConnectionSealed).not.toHaveBeenCalled();
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("falls back to meta.team_id for connections added before the column existed", async () => {
    listConnectionsByExternalId.mockResolvedValue([]);
    listConnectionIdsByMeta.mockResolvedValue([CONNECTION_ID]);

    const response = await slackPost(request(blockActions(`approve:${STEP_ID}`)));

    expect(response.status).toBe(200);
    expect(listConnectionIdsByMeta).toHaveBeenCalledWith({
      provider: "slack",
      key: "team_id",
      value: TEAM_ID,
    });
    expect(resumeByStepId).toHaveBeenCalledTimes(1);
  });

  it("lets the signature pick, when one workspace has more than one connection", async () => {
    // Two organisations can install the same Slack app into the same workspace. Only the one whose
    // signing secret signed these bytes may have its run resumed.
    listConnectionsByExternalId.mockResolvedValue([
      match(OTHER_CONNECTION_ID),
      match(CONNECTION_ID),
    ]);

    const response = await slackPost(
      request(blockActions(`approve:${STEP_ID}`), { secret: SIGNING_SECRET }),
    );

    expect(response.status).toBe(200);
    expect((resumeByStepId.mock.calls[0] as [string, unknown, string])[2]).toBe(ORG_ID);
  });

  it("confirms Slack's ssl_check probe with an empty 200", async () => {
    // `ssl_check=1` plus a token and nothing else (docs.slack.dev, slash commands): no workspace to
    // look up, and the documented answer is an empty 200 rather than the 400 an unreadable body gets.
    const response = await slackPost(request("ssl_check=1&token=Jhj5dZrVaK7ZwHHjRyZWjbDl"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(listConnectionsByExternalId).not.toHaveBeenCalled();
  });

  it("refuses a body that names no workspace, before touching Convex", async () => {
    const response = await slackPost(request("payload=%7B%22type%22%3A%22block_actions%22%7D"));

    expect(response.status).toBe(400);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: "unreadable_delivery",
    });
    expect(listConnectionsByExternalId).not.toHaveBeenCalled();
    expect(listConnectionIdsByMeta).not.toHaveBeenCalled();
  });

  it("ignores a verified payload that is not one of this node's buttons", async () => {
    const response = await slackPost(request(blockActions(`snooze:${STEP_ID}`)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("stays a 200 when nothing is waiting, and says why in the message", async () => {
    resumeByStepId.mockResolvedValue({ ok: false, status: 404 });

    const response = await slackPost(request(blockActions(`approve:${STEP_ID}`)));

    // A non-2xx paints a red banner in the channel; "already handled" is not an error.
    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      error: "not_waiting",
      replace_original: true,
    });
  });

  it("never returns or forwards a credential", async () => {
    const response = await slackPost(request(blockActions(`approve:${STEP_ID}`)));

    expectNoSecrets(await response.json(), resumeByStepId.mock.calls);
  });
});
