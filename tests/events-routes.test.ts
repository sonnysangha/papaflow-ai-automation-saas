import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as stripePost } from "@/app/api/events/stripe/[connectionId]/route";
import { POST as telegramPost } from "@/app/api/events/telegram/[connectionId]/route";

/**
 * The two per-connection inbound routes, with Convex, Clerk and the vault replaced.
 *
 * What is under test is the contract a provider sees — prove it, dedupe it, filter it, start runs —
 * plus `lib/inbound.ts`, which is deliberately left real: the fan-out and the event-type filter are
 * the parts most likely to break. The signature verifiers are real too, so the Stripe signatures
 * below are computed with `node:crypto` exactly as Stripe would.
 *
 * Factories rather than automocks: `@/lib/engine-client` pulls in the workflow definitions and the
 * Workflow SDK, none of which a route test should load.
 */
const {
  getConnectionSealed,
  getWorkflowForRun,
  listWorkflowsByTrigger,
  recordWebhookEvent,
  startRun,
  updateConnectionMeta,
  getOrgPlan,
  open,
} = vi.hoisted(() => ({
  getConnectionSealed: vi.fn(),
  getWorkflowForRun: vi.fn(),
  listWorkflowsByTrigger: vi.fn(),
  recordWebhookEvent: vi.fn(),
  startRun: vi.fn(),
  updateConnectionMeta: vi.fn(),
  getOrgPlan: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@/lib/engine-client", () => ({
  getConnectionSealed,
  getWorkflowForRun,
  listWorkflowsByTrigger,
  recordWebhookEvent,
  startRun,
  updateConnectionMeta,
}));
vi.mock("@/lib/billing", () => ({ getOrgPlan }));
vi.mock("@/lib/vault", () => ({
  open,
  aadFor: (orgId: string, connectionId: string) => `${orgId}:${connectionId}`,
}));

const CONNECTION_ID = "cn_1";
const ORG_ID = "org_1";
const WORKFLOW_ID = "wf_1";
const SECRET_TOKEN = "telegram-secret-token";
const SIGNING_SECRET = "whsec_testsecret";

/** The route's second argument: Next hands dynamic segments over as a promise. */
function context(connectionId: string = CONNECTION_ID) {
  return { params: Promise.resolve({ connectionId }) };
}

/** A sealed row as `api.engine.getConnectionSealed` returns one — the ciphertext is never read. */
function sealedRow(provider: string) {
  return {
    orgId: ORG_ID,
    provider,
    kind: provider === "telegram" ? "botToken" : "signingSecret",
    secret: { v: 1, keyId: "k1", iv: "iv", tag: "tag", ct: "ct" },
    status: "active",
  };
}

function telegramRequest(update: unknown, secretToken: string | null = SECRET_TOKEN): Request {
  return new Request(`https://app.test/api/events/telegram/${CONNECTION_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secretToken === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secretToken }),
    },
    body: JSON.stringify(update),
  });
}

/** `t=<seconds>,v1=<hex>` over `${t}.${rawBody}`, keyed with the endpoint's signing secret. */
function stripeSignature(rawBody: string, secret = SIGNING_SECRET, at = Date.now()): string {
  const timestamp = Math.floor(at / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function stripeRequest(event: unknown, header?: string): Request {
  const rawBody = JSON.stringify(event);
  return new Request(`https://app.test/api/events/stripe/${CONNECTION_ID}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header ?? stripeSignature(rawBody),
    },
    body: rawBody,
  });
}

const MESSAGE_UPDATE = {
  update_id: 42,
  message: {
    message_id: 7,
    from: { id: 99, first_name: "Sonny" },
    chat: { id: 1234567890123, type: "private", first_name: "Sonny" },
    text: "hello bot",
  },
};

const PAYMENT_EVENT = {
  id: "evt_1",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_1", amount: 4200 } },
};

/** A stored workflow whose `stripe.event` trigger is configured with `eventTypes`. */
function storedWorkflow(eventTypes: string[]) {
  return {
    name: "Notify",
    version: 3,
    webhookSecret: "s".repeat(32),
    graph: {
      nodes: [
        { id: "n0", data: { nodeType: "manual.trigger", inputs: {} } },
        {
          id: "n1",
          data: {
            nodeType: "stripe.event",
            inputs: { connectionId: CONNECTION_ID, eventTypes },
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  getOrgPlan.mockResolvedValue("pro");
  startRun.mockResolvedValue({ executionId: "ex_1", runId: "run_1" });
  updateConnectionMeta.mockResolvedValue(undefined);
  recordWebhookEvent.mockResolvedValue({ duplicate: false });
  listWorkflowsByTrigger.mockResolvedValue([{ _id: WORKFLOW_ID, orgId: ORG_ID, name: "Notify" }]);
});

describe("POST /api/events/telegram/[connectionId]", () => {
  beforeEach(() => {
    getConnectionSealed.mockResolvedValue(sealedRow("telegram"));
    open.mockReturnValue({ botToken: "123:ABC", secretToken: SECRET_TOKEN });
  });

  it("refuses a delivery whose secret token does not match", async () => {
    const response = await telegramPost(telegramRequest(MESSAGE_UPDATE, "not-the-token"), context());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "bad_secret_token" });
    expect(startRun).not.toHaveBeenCalled();
    expect(updateConnectionMeta).not.toHaveBeenCalled();
  });

  it("refuses a delivery with no secret token header at all", async () => {
    const response = await telegramPost(telegramRequest(MESSAGE_UPDATE, null), context());

    expect(response.status).toBe(401);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("starts a run, learns the chat and answers 200", async () => {
    const response = await telegramPost(telegramRequest(MESSAGE_UPDATE), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, started: 1 });

    expect(listWorkflowsByTrigger).toHaveBeenCalledWith({
      orgId: ORG_ID,
      triggerType: "telegram.message",
      connectionId: CONNECTION_ID,
    });
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith({
      orgId: ORG_ID,
      workflowId: WORKFLOW_ID,
      planSlug: "pro",
      trigger: {
        type: "telegram",
        payload: {
          update: MESSAGE_UPDATE,
          chatId: "1234567890123",
          text: "hello bot",
          from: { id: 99, first_name: "Sonny" },
        },
      },
    });

    // Telegram has no "list my chats": this is the only place `meta.chat_ids` is ever filled.
    expect(updateConnectionMeta).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      orgId: ORG_ID,
      meta: { chat_ids: [{ id: "1234567890123", type: "private", first_name: "Sonny" }] },
    });
  });

  it("answers 404 when the connection belongs to another provider", async () => {
    getConnectionSealed.mockResolvedValue(sealedRow("stripe"));

    const response = await telegramPost(telegramRequest(MESSAGE_UPDATE), context());

    expect(response.status).toBe(404);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("acknowledges a callback_query without starting a run, but still learns its chat", async () => {
    const update = {
      update_id: 43,
      callback_query: {
        id: "cb_1",
        data: "approve",
        message: { chat: { id: -100200, type: "supergroup", title: "Ops" } },
      },
    };

    const response = await telegramPost(telegramRequest(update), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, started: 0 });
    expect(startRun).not.toHaveBeenCalled();
    expect(updateConnectionMeta).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      orgId: ORG_ID,
      meta: { chat_ids: [{ id: "-100200", type: "supergroup", title: "Ops" }] },
    });
  });
});

describe("POST /api/events/stripe/[connectionId]", () => {
  beforeEach(() => {
    getConnectionSealed.mockResolvedValue(sealedRow("stripe"));
    open.mockReturnValue({ signingSecret: SIGNING_SECRET });
    // The node's default: no `eventTypes` means every event this endpoint receives.
    getWorkflowForRun.mockResolvedValue(storedWorkflow([]));
  });

  it("refuses a delivery signed with the wrong secret", async () => {
    const rawBody = JSON.stringify(PAYMENT_EVENT);
    const response = await stripePost(
      stripeRequest(PAYMENT_EVENT, stripeSignature(rawBody, "whsec_wrong")),
      context(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "bad_signature" });
    expect(recordWebhookEvent).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses a body that was changed after it was signed", async () => {
    const signed = stripeSignature(JSON.stringify(PAYMENT_EVENT));
    const tampered = stripeRequest({ ...PAYMENT_EVENT, data: { object: { amount: 1 } } }, signed);

    expect((await stripePost(tampered, context())).status).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("starts a run on a valid delivery and flips the connection to verified", async () => {
    const response = await stripePost(stripeRequest(PAYMENT_EVENT), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, started: 1 });

    expect(recordWebhookEvent).toHaveBeenCalledWith({
      source: `stripe:${CONNECTION_ID}`,
      eventId: "evt_1",
    });
    expect(updateConnectionMeta).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      orgId: ORG_ID,
      meta: { verified: true },
    });
    expect(startRun).toHaveBeenCalledWith({
      orgId: ORG_ID,
      workflowId: WORKFLOW_ID,
      planSlug: "pro",
      trigger: {
        type: "stripe",
        payload: {
          event: PAYMENT_EVENT,
          type: "payment_intent.succeeded",
          object: { id: "pi_1", amount: 4200 },
        },
      },
    });
  });

  it("answers 200 without starting anything when the same event is delivered twice", async () => {
    recordWebhookEvent.mockResolvedValue({ duplicate: true });

    const response = await stripePost(stripeRequest(PAYMENT_EVENT), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("skips a workflow whose trigger does not list this event type", async () => {
    getWorkflowForRun.mockResolvedValue(storedWorkflow(["invoice.paid"]));

    const response = await stripePost(stripeRequest(PAYMENT_EVENT), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, started: 0 });
    expect(getWorkflowForRun).toHaveBeenCalledWith(WORKFLOW_ID, ORG_ID);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("starts a workflow whose trigger lists this event type", async () => {
    getWorkflowForRun.mockResolvedValue(
      storedWorkflow(["invoice.paid", "payment_intent.succeeded"]),
    );

    const response = await stripePost(stripeRequest(PAYMENT_EVENT), context());

    expect(await response.json()).toEqual({ ok: true, started: 1 });
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("refuses a signature whose timestamp is outside the tolerance", async () => {
    const rawBody = JSON.stringify(PAYMENT_EVENT);
    const stale = stripeSignature(rawBody, SIGNING_SECRET, Date.now() - 10 * 60_000);

    expect((await stripePost(stripeRequest(PAYMENT_EVENT, stale), context())).status).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("answers 404 when no connection is listening at the URL", async () => {
    getConnectionSealed.mockRejectedValue(new Error("Connection not found"));

    const response = await stripePost(stripeRequest(PAYMENT_EVENT), context());

    expect(response.status).toBe(404);
    expect(recordWebhookEvent).not.toHaveBeenCalled();
  });
});
