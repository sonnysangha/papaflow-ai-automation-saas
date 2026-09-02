import {
  createHmac,
  generateKeyPairSync,
  sign as signEd25519,
  type KeyObject,
} from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as discordPost } from "@/app/api/events/discord/[connectionId]/route";
import { POST as slackPost } from "@/app/api/events/slack/[connectionId]/route";
import { POST as telegramPost } from "@/app/api/events/telegram/[connectionId]/route";

/**
 * The three Approval resume routes, with Convex, the vault and the hook plumbing replaced.
 *
 * Deliberately left real: `lib/inbound.ts#loadConnection` (which connection an inbound URL may
 * open, and which it must refuse) and both signature verifiers — the signatures below are computed
 * with `node:crypto` exactly as Slack and Discord compute them, so a change to either verifier
 * fails here rather than in production.
 *
 * The last test in each group is the same one: nothing a route returns, and nothing it puts in a
 * resume payload, may contain a credential (CLAUDE.md rule 1). The routes hold a Slack signing
 * secret, a Discord public key and a Telegram bot token while they run, and all three are only ever
 * compared or used to call the provider.
 *
 * Factories rather than automocks: `@/lib/engine-client` pulls in the workflow definitions and the
 * Workflow SDK, none of which a route test should load.
 */
const { getConnectionSealed, updateConnectionMeta, listWorkflowsByTrigger, startRun, getOrgPlan, open, resumeByStepId } =
  vi.hoisted(() => ({
    getConnectionSealed: vi.fn(),
    updateConnectionMeta: vi.fn(),
    listWorkflowsByTrigger: vi.fn(),
    startRun: vi.fn(),
    getOrgPlan: vi.fn(),
    open: vi.fn(),
    resumeByStepId: vi.fn(),
  }));

vi.mock("@/lib/engine-client", () => ({
  getConnectionSealed,
  updateConnectionMeta,
  listWorkflowsByTrigger,
  startRun,
}));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));
vi.mock("@/lib/vault", () => ({
  open,
  aadFor: (orgId: string, connectionId: string) => `${orgId}:${connectionId}`,
}));
vi.mock("@/lib/hooks", () => ({ resumeByStepId }));

const CONNECTION_ID = "cn_1";
const ORG_ID = "org_1";
const STEP_ID = "k17d9ab2c3e4f5g6h7i8j9k0l1m2n3o4";
const SIGNING_SECRET = "slack-signing-secret-abcdef0123456789";
const SLACK_BOT_TOKEN = "xoxb-1111-2222-approvaltokenabcd";
const TELEGRAM_TOKEN = "123456789:AAF-approval-token-abcdefghij";
const TELEGRAM_SECRET_TOKEN = "telegram-secret-token";

/** Every secret a route holds while it runs; none of them may appear in what it hands back. */
const SECRETS = [SIGNING_SECRET, SLACK_BOT_TOKEN, TELEGRAM_TOKEN, TELEGRAM_SECRET_TOKEN];

/** The route's second argument: Next hands dynamic segments over as a promise. */
function context(connectionId: string = CONNECTION_ID) {
  return { params: Promise.resolve({ connectionId }) };
}

/** A sealed row as `api.engine.getConnectionSealed` returns one — the ciphertext is never read. */
function sealedRow(provider: string, meta: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    provider,
    kind: "botToken",
    secret: { v: 1, keyId: "k1", iv: "iv", tag: "tag", ct: "ct" },
    status: "active",
    meta,
  };
}

const RESUMED = {
  ok: true,
  executionId: "ex_1",
  nodeId: "approval_1",
  nodeType: "logic.approval",
  orgId: ORG_ID,
};

/** Asserts that a response body — and anything handed to `resumeByStepId` — is secret-free. */
function expectNoSecrets(...values: unknown[]): void {
  const text = JSON.stringify(values);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  getOrgPlan.mockResolvedValue("free_org");
  listWorkflowsByTrigger.mockResolvedValue([]);
  updateConnectionMeta.mockResolvedValue(undefined);
  resumeByStepId.mockResolvedValue(RESUMED);
});

/* ---------------------------------------------------------------------------------------------- */

describe("POST /api/events/slack/[connectionId]", () => {
  const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

  function slackRequest(
    rawBody: string,
    {
      timestamp = String(NOW_SECONDS()),
      secret = SIGNING_SECRET,
      contentType = "application/x-www-form-urlencoded",
      signature,
    }: {
      timestamp?: string;
      secret?: string;
      contentType?: string;
      signature?: string;
    } = {},
  ): Request {
    const digest = createHmac("sha256", secret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");

    return new Request(`https://app.test/api/events/slack/${CONNECTION_ID}`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature ?? `v0=${digest}`,
      },
      body: rawBody,
    });
  }

  /** The form-encoded interactivity body Slack actually posts. */
  function blockActions(value: string, username = "roadrunner"): string {
    const payload = {
      type: "block_actions",
      user: { id: "U2CERLKJA", username },
      actions: [{ action_id: value.startsWith("approve") ? "approve" : "reject", value }],
    };
    return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  }

  beforeEach(() => {
    getConnectionSealed.mockResolvedValue(sealedRow("slack"));
    open.mockReturnValue({ botToken: SLACK_BOT_TOKEN, signingSecret: SIGNING_SECRET });
  });

  it("echoes the url_verification challenge once the signature checks out", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "3eZbrw1aB" });

    const response = await slackPost(
      slackRequest(body, { contentType: "application/json" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "3eZbrw1aB" });
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("resumes down `approved` and replaces the message", async () => {
    const response = await slackPost(
      slackRequest(blockActions(`approve:${STEP_ID}`)),
      context(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ replace_original: true, text: "✅ Approved by roadrunner" });

    expect(resumeByStepId).toHaveBeenCalledTimes(1);
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
    const response = await slackPost(slackRequest(blockActions(`reject:${STEP_ID}`)), context());

    expect(await response.json()).toEqual({
      replace_original: true,
      text: "❌ Rejected by roadrunner",
    });
    expect((resumeByStepId.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      approved: false,
      handle: "rejected",
    });
  });

  it("answers 401 for a forged signature, a stale timestamp and a missing header alike", async () => {
    const body = blockActions(`approve:${STEP_ID}`);

    const forged = await slackPost(
      slackRequest(body, { secret: "someone-elses-signing-secret" }),
      context(),
    );
    expect(forged.status).toBe(401);

    const stale = await slackPost(
      slackRequest(body, { timestamp: String(NOW_SECONDS() - 3600) }),
      context(),
    );
    expect(stale.status).toBe(401);

    const unsigned = new Request(`https://app.test/api/events/slack/${CONNECTION_ID}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect((await slackPost(unsigned, context())).status).toBe(401);

    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("says so when the connection has no signing secret, without verifying anything", async () => {
    open.mockReturnValue({ botToken: SLACK_BOT_TOKEN });

    const response = await slackPost(slackRequest(blockActions(`approve:${STEP_ID}`)), context());

    expect(response.status).toBe(400);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: "no_signing_secret",
    });
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("is a 404 for a connection that is not this org's Slack app", async () => {
    getConnectionSealed.mockResolvedValue(sealedRow("telegram"));

    const response = await slackPost(slackRequest(blockActions(`approve:${STEP_ID}`)), context());
    expect(response.status).toBe(404);
  });

  it("stays a 200 when nothing is waiting, and says why in the message", async () => {
    resumeByStepId.mockResolvedValue({ ok: false, status: 404 });

    const response = await slackPost(slackRequest(blockActions(`approve:${STEP_ID}`)), context());

    // A non-2xx paints a red banner in the channel; "already handled" is not an error.
    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      error: "not_waiting",
      replace_original: true,
    });
  });

  it("ignores a payload that is not one of this node's buttons", async () => {
    const response = await slackPost(
      slackRequest(blockActions(`snooze:${STEP_ID}`)),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("never returns or forwards a credential", async () => {
    const response = await slackPost(slackRequest(blockActions(`approve:${STEP_ID}`)), context());

    expectNoSecrets(await response.json(), resumeByStepId.mock.calls);
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe("POST /api/events/discord/[connectionId]", () => {
  let publicKeyHex: string;
  let privateKey: KeyObject;

  function discordRequest(
    interaction: unknown,
    { key = privateKey, timestamp = "1756800000" }: { key?: KeyObject; timestamp?: string } = {},
  ): Request {
    const rawBody = JSON.stringify(interaction);
    const signature = signEd25519(
      null,
      Buffer.from(`${timestamp}${rawBody}`, "utf8"),
      key,
    ).toString("hex");

    return new Request(`https://app.test/api/events/discord/${CONNECTION_ID}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-timestamp": timestamp,
        "x-signature-ed25519": signature,
      },
      body: rawBody,
    });
  }

  beforeEach(() => {
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: "jwk" }) as { x?: string };
    publicKeyHex = Buffer.from(jwk.x ?? "", "base64url").toString("hex");

    getConnectionSealed.mockResolvedValue(sealedRow("discord-bot", { publicKey: publicKeyHex }));
    open.mockReturnValue({ botToken: "MTIz.discord-bot-token", applicationId: "123" });
  });

  it("answers a signed PING with a PONG", async () => {
    const response = await discordPost(discordRequest({ type: 1 }), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("resumes a component press and updates the message in place", async () => {
    const response = await discordPost(
      discordRequest({
        type: 3,
        data: { custom_id: `approve:${STEP_ID}` },
        member: { user: { id: "42", username: "sonny", global_name: "Sonny" } },
      }),
      context(),
    );

    expect(response.status).toBe(200);
    // Type 7 is UPDATE_MESSAGE: the buttons go away with the decision written in their place.
    expect(await response.json()).toEqual({
      type: 7,
      data: { content: "✅ Approved by Sonny", components: [] },
    });

    const [stepId, payload, orgId] = resumeByStepId.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(stepId).toBe(STEP_ID);
    expect(payload).toEqual({
      approved: true,
      by: "Sonny",
      provider: "discord-bot",
      handle: "approved",
    });
    expect(orgId).toBe(ORG_ID);
  });

  it("answers 401 for a signature made with a different key — Discord tests for exactly this", async () => {
    const other = generateKeyPairSync("ed25519");

    const response = await discordPost(
      discordRequest({ type: 1 }, { key: other.privateKey }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("says so when the connection has no public key", async () => {
    getConnectionSealed.mockResolvedValue(sealedRow("discord-bot"));

    const response = await discordPost(discordRequest({ type: 1 }), context());

    expect(response.status).toBe(400);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      code: "no_public_key",
    });
  });

  it("answers an ephemeral 'Unsupported' for anything that is not a button", async () => {
    const command = await discordPost(discordRequest({ type: 2, data: { name: "papaflow" } }), context());
    expect(await command.json()).toEqual({
      type: 4,
      data: { content: "Unsupported", flags: 64 },
    });

    const foreign = await discordPost(
      discordRequest({ type: 3, data: { custom_id: "someone-elses-button" } }),
      context(),
    );
    expect(await foreign.json()).toEqual({ type: 4, data: { content: "Unsupported", flags: 64 } });
    expect(resumeByStepId).not.toHaveBeenCalled();
  });

  it("stays a 200 when nothing is waiting", async () => {
    resumeByStepId.mockResolvedValue({ ok: false, status: 404 });

    const response = await discordPost(
      discordRequest({ type: 3, data: { custom_id: `reject:${STEP_ID}` } }),
      context(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { type: number; data: { content: string } };
    expect(body.type).toBe(7);
    expect(body.data.content).toContain("no longer waiting");
  });

  it("never returns or forwards a credential", async () => {
    const response = await discordPost(
      discordRequest({ type: 3, data: { custom_id: `approve:${STEP_ID}` } }),
      context(),
    );

    expectNoSecrets(await response.json(), resumeByStepId.mock.calls);
  });
});

/* ---------------------------------------------------------------------------------------------- */

describe("POST /api/events/telegram/[connectionId] — callback_query", () => {
  type FetchArgs = [input: string | URL | Request, init?: RequestInit];

  function telegramRequest(update: unknown, secretToken: string | null = TELEGRAM_SECRET_TOKEN) {
    return new Request(`https://app.test/api/events/telegram/${CONNECTION_ID}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secretToken === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secretToken }),
      },
      body: JSON.stringify(update),
    });
  }

  function callbackUpdate(data: string) {
    return {
      update_id: 43,
      callback_query: {
        id: "4382bfdwdsb323b2d9",
        data,
        from: { id: 99, username: "sonny", first_name: "Sonny" },
        message: {
          message_id: 7,
          chat: { id: 1234567890123, type: "group", title: "Deploys" },
        },
      },
    };
  }

  function stubTelegramApi() {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    getConnectionSealed.mockResolvedValue(
      sealedRow("telegram", { chat_ids: [{ id: "1234567890123" }] }),
    );
    open.mockReturnValue({ botToken: TELEGRAM_TOKEN, secretToken: TELEGRAM_SECRET_TOKEN });
  });

  it("resumes the run, answers the callback and takes the buttons away", async () => {
    const fetchMock = stubTelegramApi();

    const response = await telegramPost(
      telegramRequest(callbackUpdate(`approve:${STEP_ID}`)),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, resumed: true });

    const [stepId, payload, orgId] = resumeByStepId.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(stepId).toBe(STEP_ID);
    expect(payload).toEqual({
      approved: true,
      by: "sonny",
      provider: "telegram",
      handle: "approved",
    });
    expect(orgId).toBe(ORG_ID);

    const calls = fetchMock.mock.calls as unknown as FetchArgs[];
    expect(calls.map(([url]) => String(url))).toEqual([
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageReplyMarkup`,
    ]);

    const answered = JSON.parse(String(calls[0][1]?.body)) as Record<string, unknown>;
    expect(answered).toMatchObject({ callback_query_id: "4382bfdwdsb323b2d9" });
    expect(answered.text).toBe("✅ Approved by sonny");

    const edited = JSON.parse(String(calls[1][1]?.body)) as Record<string, unknown>;
    expect(edited).toMatchObject({ chat_id: "1234567890123", message_id: 7 });
    // An empty keyboard is how the buttons disappear without touching the message text.
    expect(edited.reply_markup).toEqual({ inline_keyboard: [] });

    // A button press is not a message: no run may be started by one.
    expect(startRun).not.toHaveBeenCalled();
  });

  it("resumes down `rejected` for the other button", async () => {
    stubTelegramApi();

    await telegramPost(telegramRequest(callbackUpdate(`reject:${STEP_ID}`)), context());

    expect((resumeByStepId.mock.calls[0] as [string, Record<string, unknown>])[1]).toMatchObject({
      approved: false,
      handle: "rejected",
    });
  });

  it("still tidies up when the run has already moved on", async () => {
    const fetchMock = stubTelegramApi();
    resumeByStepId.mockResolvedValue({ ok: false, status: 404 });

    const response = await telegramPost(
      telegramRequest(callbackUpdate(`approve:${STEP_ID}`)),
      context(),
    );

    expect(await response.json()).toEqual({ ok: true, resumed: false });
    const answered = JSON.parse(
      String((fetchMock.mock.calls as unknown as FetchArgs[])[0][1]?.body),
    ) as { text?: string };
    expect(answered.text).toContain("no longer waiting");
  });

  it("refuses a callback whose secret token does not match, before resuming anything", async () => {
    const fetchMock = stubTelegramApi();

    const response = await telegramPost(
      telegramRequest(callbackUpdate(`approve:${STEP_ID}`), "not-the-token"),
      context(),
    );

    expect(response.status).toBe(401);
    expect(resumeByStepId).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves a callback_query this build did not send alone", async () => {
    const fetchMock = stubTelegramApi();

    const response = await telegramPost(
      telegramRequest(callbackUpdate("someone-elses-button")),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, started: 0 });
    expect(resumeByStepId).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never returns or forwards a credential", async () => {
    stubTelegramApi();

    const response = await telegramPost(
      telegramRequest(callbackUpdate(`approve:${STEP_ID}`)),
      context(),
    );

    expectNoSecrets(await response.json(), resumeByStepId.mock.calls);
  });
});
