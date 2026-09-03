import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectorTestResult } from "@/connectors/define";
import { stripeConnector } from "@/connectors/stripe";
import { telegramConnector } from "@/connectors/telegram";
import { stripeEventTriggerNode } from "@/nodes/triggers/stripe-event";
import { telegramMessageTriggerNode } from "@/nodes/triggers/telegram-message";

/**
 * The two inbound connectors, exercised against a routing table like `tests/validate.test.ts`:
 * a request to a URL the verified docs do not list is a failure, not a silent pass. Nothing here
 * touches the network, and the bot token only ever appears inside an asserted URL.
 */

const TOKEN = "123456789:AAF-testtoken-abcdefghijklmnop";
const CONNECTION = "j57d0000000000000000000000";
const GET_ME = `https://api.telegram.org/bot${TOKEN}/getMe`;
const SET_WEBHOOK = `https://api.telegram.org/bot${TOKEN}/setWebhook`;

type Route = { status?: number; body?: unknown } | { throws: true };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function stubFetch(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: { ...(init.headers as Record<string, string> | undefined) },
        body: typeof init.body === "string" ? init.body : undefined,
      });
      const route = routes[url];
      if (!route) throw new Error(`unstubbed request: ${url}`);
      if ("throws" in route) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(route.body ?? {}), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

/** No connector may reach the network unless a test said it could. */
function forbidFetch(): Call[] {
  return stubFetch({});
}

function expectOk(result: ConnectorTestResult) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

function expectFailed(result: ConnectorTestResult) {
  if (result.ok) throw new Error(`expected failure, got: ${result.label}`);
  return result;
}

const GET_ME_OK = { body: { ok: true, result: { id: 123456789, is_bot: true, username: "papaflow_bot" } } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telegram connector", () => {
  it("is a free chat bot-token connector with one secret field", () => {
    expect(telegramConnector).toMatchObject({
      provider: "telegram",
      name: "Telegram",
      category: "chat",
      kind: "botToken",
      requiresFeature: null,
      icon: "Send",
    });
    expect(telegramConnector.fields).toHaveLength(1);
    expect(telegramConnector.fields[0]).toMatchObject({
      name: "botToken",
      kind: "secret",
      help: "From @BotFather",
    });
    expect(telegramConnector.docsUrl).toMatch(/^https:\/\//);
  });

  it("validates a token with getMe and captures the bot identity", async () => {
    const calls = stubFetch({ [GET_ME]: GET_ME_OK });

    const result = expectOk(await telegramConnector.test({ botToken: TOKEN }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: GET_ME, method: "GET" });
    expect(result.label).toBe("@papaflow_bot");
    expect(result.hint).toBe(TOKEN.slice(-4));
    expect(result.meta).toEqual({ bot_username: "papaflow_bot", bot_id: 123456789 });
  });

  it("reports a rejected token, a described refusal and an unreachable API", async () => {
    stubFetch({ [GET_ME]: { status: 401, body: { ok: false, description: "Unauthorized" } } });
    expect(expectFailed(await telegramConnector.test({ botToken: TOKEN })).error).toMatch(/bot token/i);

    vi.unstubAllGlobals();
    stubFetch({ [GET_ME]: { status: 400, body: { ok: false, description: "Bad Request: chat not found" } } });
    expect(expectFailed(await telegramConnector.test({ botToken: TOKEN })).error).toMatch(/chat not found/);

    vi.unstubAllGlobals();
    stubFetch({ [GET_ME]: { throws: true } });
    expect(expectFailed(await telegramConnector.test({ botToken: TOKEN })).error).toMatch(/Could not reach Telegram/);
  });

  it("refuses a blank token without calling Telegram", async () => {
    const calls = forbidFetch();
    expectFailed(await telegramConnector.test({ botToken: "   " }));
    expect(calls).toHaveLength(0);
  });

  it("refuses a 200 that carries no username", async () => {
    stubFetch({ [GET_ME]: { body: { ok: true, result: { id: 1, is_bot: true } } } });
    expect(expectFailed(await telegramConnector.test({ botToken: TOKEN })).error).toMatch(/username/);
  });

  it("registers the per-connection webhook with a generated secret token", async () => {
    const calls = stubFetch({ [SET_WEBHOOK]: { body: { ok: true, result: true } } });

    const extra = await telegramConnector.afterCreate!({
      connectionId: CONNECTION,
      secret: { botToken: TOKEN },
      appOrigin: "https://papaflow.vercel.app",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: SET_WEBHOOK, method: "POST" });
    expect(calls[0].headers).toMatchObject({ "Content-Type": "application/json" });

    const inboundUrl = `https://papaflow.vercel.app/api/events/telegram/${CONNECTION}`;
    const secretToken = extra.secret?.secretToken ?? "";
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      url: inboundUrl,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    });

    // Stored inside the sealed secret, never in `meta` — it authenticates every inbound update.
    expect(extra.secret).toEqual({ botToken: TOKEN, secretToken });
    expect(secretToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(extra.meta).toEqual({ webhookSet: true, inboundUrl });
  });

  it("generates a different secret token for every connection", async () => {
    stubFetch({ [SET_WEBHOOK]: { body: { ok: true, result: true } } });

    const args = { connectionId: CONNECTION, secret: { botToken: TOKEN }, appOrigin: "https://papaflow.vercel.app" };
    const first = await telegramConnector.afterCreate!(args);
    const second = await telegramConnector.afterCreate!(args);

    expect(first.secret?.secretToken).not.toBe(second.secret?.secretToken);
  });

  it("skips setWebhook when APP_ORIGIN is not https, but still seals a secret token", async () => {
    const calls = forbidFetch();

    const extra = await telegramConnector.afterCreate!({
      connectionId: CONNECTION,
      secret: { botToken: TOKEN },
      appOrigin: "http://localhost:3000",
    });

    expect(calls).toHaveLength(0);
    expect(extra.secret?.secretToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(extra.meta).toEqual({
      webhookSet: false,
      webhookSkipped: "APP_ORIGIN is not https",
      inboundUrl: `http://localhost:3000/api/events/telegram/${CONNECTION}`,
    });
  });

  it("throws when Telegram refuses setWebhook, so the half-made connection is rolled back", async () => {
    stubFetch({ [SET_WEBHOOK]: { status: 400, body: { ok: false, description: "Bad Request: bad webhook: HTTPS url must be provided" } } });

    await expect(
      telegramConnector.afterCreate!({
        connectionId: CONNECTION,
        secret: { botToken: TOKEN },
        appOrigin: "https://papaflow.vercel.app",
      }),
    ).rejects.toThrow(/setWebhook failed/);
  });

  it("offers the chats it has learned from inbound updates, and nothing else", async () => {
    const calls = forbidFetch();
    const meta = {
      chat_ids: [
        { id: -1001234567890, title: "PapaFam", type: "supergroup" },
        { id: 42, first_name: "Sonny", type: "private" },
        { id: 7, type: "private" },
        "not-a-chat",
      ],
    };

    // DMs first, and marked as such: a private chat is what somebody reaching for "ask *me*"
    // wants, and a bare first name between two group titles reads like a third group.
    expect(await telegramConnector.pick!("chats", { botToken: TOKEN }, meta)).toEqual([
      { id: "42", label: "DM · Sonny" },
      // Learned before Telegram sent a name for it: still selectable, labelled by its id.
      { id: "7", label: "7" },
      { id: "-1001234567890", label: "PapaFam" },
    ]);
    expect(await telegramConnector.pick!("chats", { botToken: TOKEN }, {})).toEqual([]);
    expect(await telegramConnector.pick!("models", { botToken: TOKEN }, meta)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("stripe connector", () => {
  it("is a free payments signing-secret connector with one secret field", () => {
    expect(stripeConnector).toMatchObject({
      provider: "stripe",
      name: "Stripe",
      category: "payments",
      kind: "signingSecret",
      requiresFeature: null,
      icon: "CreditCard",
    });
    expect(stripeConnector.fields).toHaveLength(1);
    expect(stripeConnector.fields[0]).toMatchObject({
      name: "signingSecret",
      kind: "secret",
      placeholder: "whsec_…",
      help: "From the Stripe webhook endpoint you point at PapaFlow",
    });
  });

  it("accepts a pasted signing secret as unverified, without calling Stripe", async () => {
    const calls = forbidFetch();

    const result = expectOk(await stripeConnector.test({ signingSecret: "whsec_abcdefghijklmnop1234" }));

    expect(calls).toHaveLength(0);
    expect(result.label).toBe("Stripe webhook");
    expect(result.hint).toBe("1234");
    expect(result.meta).toEqual({ verified: false });
  });

  it("refuses a blank signing secret", async () => {
    const calls = forbidFetch();
    expect(expectFailed(await stripeConnector.test({ signingSecret: "  " })).error).toMatch(/whsec_/);
    expect(calls).toHaveLength(0);
  });

  it("hands back the inbound URL to paste into Stripe, and no new secret", async () => {
    const calls = forbidFetch();

    const extra = await stripeConnector.afterCreate!({
      connectionId: CONNECTION,
      secret: { signingSecret: "whsec_abcdefghijklmnop1234" },
      appOrigin: "https://papaflow.vercel.app",
    });

    expect(calls).toHaveLength(0);
    expect(extra.secret).toBeUndefined();
    expect(extra.meta).toEqual({ inboundUrl: `https://papaflow.vercel.app/api/events/stripe/${CONNECTION}` });
  });
});

describe("inbound trigger nodes", () => {
  it("describes the telegram message trigger against its connection", () => {
    expect(telegramMessageTriggerNode).toMatchObject({
      type: "telegram.message",
      category: "trigger",
      icon: "Send",
      credential: "telegram",
      requiresFeature: null,
      version: "v1",
    });

    expect(telegramMessageTriggerNode.inputs.parse({ connectionId: CONNECTION })).toEqual({
      connectionId: CONNECTION,
    });
    expect(telegramMessageTriggerNode.inputs.safeParse({}).success).toBe(false);

    const payload = { update: { update_id: 1 }, chatId: "42", text: "hi", from: { id: 7 } };
    expect(telegramMessageTriggerNode.outputs.parse(payload)).toEqual(payload);
    expect(telegramMessageTriggerNode.outputs.safeParse({ update: {}, chatId: 42, from: null }).success).toBe(false);
  });

  it("describes the stripe event trigger with an all-events default", () => {
    expect(stripeEventTriggerNode).toMatchObject({
      type: "stripe.event",
      category: "trigger",
      icon: "CreditCard",
      credential: "stripe",
      requiresFeature: null,
      version: "v1",
    });

    expect(stripeEventTriggerNode.inputs.parse({ connectionId: CONNECTION })).toEqual({
      connectionId: CONNECTION,
      eventTypes: [],
    });
    expect(
      stripeEventTriggerNode.inputs.parse({ connectionId: CONNECTION, eventTypes: ["payment_intent.succeeded"] }),
    ).toEqual({ connectionId: CONNECTION, eventTypes: ["payment_intent.succeeded"] });

    const payload = { event: { id: "evt_1" }, type: "payment_intent.succeeded", object: { id: "pi_1" } };
    expect(stripeEventTriggerNode.outputs.parse(payload)).toEqual(payload);
  });

  it("returns a payload-shaped output without doing any I/O, since routes feed these triggers", async () => {
    const calls = forbidFetch();
    const context = { orgId: "org_1", executionId: "ex_1", nodeId: "n1" };

    const telegram = await telegramMessageTriggerNode.run({ inputs: { connectionId: CONNECTION }, ...context });
    expect(telegramMessageTriggerNode.outputs.safeParse(telegram).success).toBe(true);

    const stripe = await stripeEventTriggerNode.run({
      inputs: { connectionId: CONNECTION, eventTypes: [] },
      ...context,
    });
    expect(stripeEventTriggerNode.outputs.safeParse(stripe).success).toBe(true);

    expect(calls).toHaveLength(0);
  });
});
