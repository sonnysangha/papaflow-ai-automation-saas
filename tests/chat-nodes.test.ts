import { afterEach, describe, expect, it, vi } from "vitest";

import { discordPostNode } from "@/nodes/actions/discord-post";
import { slackPostNode } from "@/nodes/actions/slack-post";
import { telegramSendNode } from "@/nodes/actions/telegram-send";
import { ConnectorError, type AnyNodeDef, type RunContext } from "@/nodes/define";
import { toJsonSchema } from "@/nodes/schema";

/**
 * The three chat action nodes. Every provider call is mocked: what is asserted is the URL, the
 * headers, the JSON body and — the part `runNode` depends on — the `ConnectorError` status, since
 * that is what decides between "fix your configuration" and "retry after N seconds"
 * (CLAUDE.md rule 7).
 */

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

const SLACK_TOKEN = "xoxb-1111-2222-testtokenabcd";
const TELEGRAM_TOKEN = "123456789:AAF-testtoken-abcdefghijklmnop";
const DISCORD_TOKEN = "MTIzNDU2Nzg5.Gabcde.bot-token-wxyz";
const WEBHOOK_URL = "https://discord.com/api/webhooks/987654321098765432/aBcDeF-webhook-token_1234";

function ctx<I>(inputs: I, credential?: Record<string, unknown>): RunContext<I> {
  return { inputs, credential, orgId: "org_test", executionId: "exec_test", nodeId: "node_test" };
}

function mockFetch(impl: (...args: FetchArgs) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Answers every request with this JSON, so a test only has to say what came back. */
function reply(body: unknown, init: ResponseInit = {}) {
  return mockFetch(async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
    }),
  );
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
}

async function caught(promise: Promise<unknown>): Promise<ConnectorError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the node run to reject");
    },
    (cause: unknown) => cause,
  );
  if (!(error instanceof ConnectorError)) throw new Error(`expected a ConnectorError, got: ${String(error)}`);
  return error;
}

/** The `picker: "<kind>"` a node input declares, as the config panel reads it back. */
function pickerOf(definition: AnyNodeDef, property: string): unknown {
  const schema = toJsonSchema(definition.inputs);
  const properties = (schema.properties ?? {}) as Record<string, { picker?: unknown }>;
  return properties[property]?.picker;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("slack.postMessage", () => {
  const CREDENTIAL = { provider: "slack", kind: "botToken", botToken: SLACK_TOKEN };

  it("is a Pro Slack action whose channel field asks for a picker", () => {
    expect(slackPostNode).toMatchObject({
      type: "slack.postMessage",
      category: "chat",
      credential: "slack",
      requiresFeature: "pro_connectors",
      version: "v1",
    });
    expect(pickerOf(slackPostNode, "channel")).toBe("channels");
  });

  it("posts to chat.postMessage with the bot token and returns the timestamp", async () => {
    const fetchMock = reply({ ok: true, ts: "1712345678.000100", channel: "C1" });

    await expect(
      slackPostNode.run(ctx({ connectionId: "c1", channel: "C1", text: "hello" }, CREDENTIAL)),
    ).resolves.toEqual({ ts: "1712345678.000100", channel: "C1" });

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init?.method).toBe("POST");
    expect(headersOf(init).Authorization).toBe(`Bearer ${SLACK_TOKEN}`);
    expect(bodyOf(init)).toEqual({ channel: "C1", text: "hello" });
  });

  it("sends Block Kit JSON alongside the fallback text", async () => {
    const fetchMock = reply({ ok: true, ts: "1.2", channel: "C1" });

    await slackPostNode.run(
      ctx(
        {
          connectionId: "c1",
          channel: "#general",
          text: "fallback",
          blocks: '[{"type":"section","text":{"type":"mrkdwn","text":"hi"}}]',
        },
        CREDENTIAL,
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(bodyOf(init)).toEqual({
      channel: "#general",
      text: "fallback",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "hi" } }],
    });
  });

  it("refuses unparseable or non-array blocks before calling Slack", async () => {
    const fetchMock = mockFetch(async () => new Response("{}"));

    const broken = await caught(
      slackPostNode.run(ctx({ connectionId: "c1", channel: "C1", text: "x", blocks: "{" }, CREDENTIAL)),
    );
    expect(broken.status).toBe(400);
    expect(broken.message).toMatch(/valid JSON/i);

    const notAnArray = await caught(
      slackPostNode.run(ctx({ connectionId: "c1", channel: "C1", text: "x", blocks: "{}" }, CREDENTIAL)),
    );
    expect(notAnArray.message).toMatch(/array/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns `ok: false` into a fatal 400 carrying Slack's own error", async () => {
    reply({ ok: false, error: "channel_not_found" });

    const error = await caught(
      slackPostNode.run(ctx({ connectionId: "c1", channel: "C-nope", text: "x" }, CREDENTIAL)),
    );
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/channel_not_found/);
  });

  it("turns a 429 into a retryable error carrying Retry-After", async () => {
    reply({ ok: false, error: "ratelimited" }, { status: 429, headers: { "retry-after": "12" } });

    const error = await caught(
      slackPostNode.run(ctx({ connectionId: "c1", channel: "C1", text: "x" }, CREDENTIAL)),
    );
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("12");
  });

  it("refuses a connection with no bot token", async () => {
    const fetchMock = mockFetch(async () => new Response("{}"));
    const error = await caught(
      slackPostNode.run(ctx({ connectionId: "c1", channel: "C1", text: "x" }, { provider: "slack" })),
    );
    expect(error.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("discord.postMessage", () => {
  const WEBHOOK = { provider: "discord-webhook", kind: "webhookUrl", webhookUrl: WEBHOOK_URL };
  const BOT = { provider: "discord-bot", kind: "botToken", botToken: DISCORD_TOKEN };

  it("takes either kind of Discord connection and asks for a channel picker", () => {
    expect(discordPostNode).toMatchObject({
      type: "discord.postMessage",
      category: "chat",
      credential: "discord",
      requiresFeature: null,
    });
    expect(pickerOf(discordPostNode, "channelId")).toBe("channels");
  });

  it("posts a webhook message with ?wait=true and no auth header", async () => {
    const fetchMock = reply({ id: "M1" });

    await expect(
      discordPostNode.run(ctx({ connectionId: "c1", content: "hello" }, WEBHOOK)),
    ).resolves.toEqual({ id: "M1" });

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe(`${WEBHOOK_URL}?wait=true`);
    expect(headersOf(init).Authorization).toBeUndefined();
    expect(bodyOf(init)).toEqual({ content: "hello" });
  });

  it("posts a bot message to the chosen channel with a Bot token", async () => {
    const fetchMock = reply({ id: "M2" });

    await expect(
      discordPostNode.run(ctx({ connectionId: "c1", channelId: "C42", content: "hi" }, BOT)),
    ).resolves.toEqual({ id: "M2" });

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("https://discord.com/api/v10/channels/C42/messages");
    expect(headersOf(init).Authorization).toBe(`Bot ${DISCORD_TOKEN}`);
  });

  it("builds a single embed from the embed fields", async () => {
    const fetchMock = reply({ id: "M3" });

    await discordPostNode.run(
      ctx(
        {
          connectionId: "c1",
          embedTitle: "Deploy finished",
          embedDescription: "main → production",
          embedUrl: "https://example.com/run/1",
        },
        WEBHOOK,
      ),
    );

    const [, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(bodyOf(init)).toEqual({
      embeds: [
        {
          title: "Deploy finished",
          description: "main → production",
          url: "https://example.com/run/1",
        },
      ],
    });
  });

  it("refuses an empty message, and a bot post with no channel, before calling Discord", async () => {
    const fetchMock = mockFetch(async () => new Response("{}"));

    const empty = await caught(discordPostNode.run(ctx({ connectionId: "c1" }, WEBHOOK)));
    expect(empty.status).toBe(400);
    expect(empty.message).toMatch(/content/i);

    const noChannel = await caught(discordPostNode.run(ctx({ connectionId: "c1", content: "hi" }, BOT)));
    expect(noChannel.status).toBe(400);
    expect(noChannel.message).toMatch(/channel/i);

    const noUrl = await caught(
      discordPostNode.run(ctx({ connectionId: "c1", content: "hi" }, { provider: "discord-webhook" })),
    );
    expect(noUrl.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes a deleted webhook fatal (404 / code 10015)", async () => {
    reply({ message: "Unknown Webhook", code: 10015 }, { status: 404 });

    const error = await caught(discordPostNode.run(ctx({ connectionId: "c1", content: "hi" }, WEBHOOK)));
    expect(error.status).toBe(404);
    expect(error.message).toMatch(/deleted/i);
  });

  it("reads the 429 wait out of the JSON body, in seconds", async () => {
    reply({ message: "You are being rate limited.", retry_after: 1.5, global: false }, { status: 429 });

    const error = await caught(
      discordPostNode.run(ctx({ connectionId: "c1", channelId: "C42", content: "hi" }, BOT)),
    );
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("1.5");
  });

  it("passes other refusals through with their own status", async () => {
    reply({ message: "Missing Permissions", code: 50013 }, { status: 403 });

    const error = await caught(
      discordPostNode.run(ctx({ connectionId: "c1", channelId: "C42", content: "hi" }, BOT)),
    );
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/Missing Permissions/);
  });
});

describe("telegram.sendMessage", () => {
  const CREDENTIAL = { provider: "telegram", kind: "botToken", botToken: TELEGRAM_TOKEN };
  const SEND = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  it("is a free Telegram action whose chat field asks for a picker", () => {
    expect(telegramSendNode).toMatchObject({
      type: "telegram.sendMessage",
      category: "chat",
      credential: "telegram",
      requiresFeature: null,
    });
    expect(pickerOf(telegramSendNode, "chatId")).toBe("chats");
  });

  it("sends HTML by default and returns the message id", async () => {
    const fetchMock = reply({ ok: true, result: { message_id: 4242, chat: { id: 7 } } });

    // Parsed rather than hand-written, so the `parseMode` default is the one the engine applies.
    const inputs = telegramSendNode.inputs.parse({ connectionId: "c1", chatId: "7", text: "hello" });
    await expect(telegramSendNode.run(ctx(inputs, CREDENTIAL))).resolves.toEqual({ messageId: 4242 });

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe(SEND);
    expect(init?.method).toBe("POST");
    expect(bodyOf(init)).toEqual({ chat_id: "7", text: "hello", parse_mode: "HTML" });
  });

  it('omits parse_mode entirely for "none"', async () => {
    const fetchMock = reply({ ok: true, result: { message_id: 1 } });

    await telegramSendNode.run(
      ctx({ connectionId: "c1", chatId: "@papaflow", text: "a < b & c", parseMode: "none" as const }, CREDENTIAL),
    );

    expect(bodyOf((fetchMock.mock.calls[0] as FetchArgs)[1])).toEqual({
      chat_id: "@papaflow",
      text: "a < b & c",
    });
  });

  it("reads the 429 wait out of parameters.retry_after", async () => {
    reply(
      { ok: false, description: "Too Many Requests: retry after 30", parameters: { retry_after: 30 } },
      { status: 429 },
    );

    const error = await caught(
      telegramSendNode.run(
        ctx({ connectionId: "c1", chatId: "7", text: "x", parseMode: "HTML" as const }, CREDENTIAL),
      ),
    );
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("30");
  });

  it("makes a bad chat id fatal and a Telegram outage retryable", async () => {
    reply({ ok: false, description: "Bad Request: chat not found" }, { status: 400 });
    const fatal = await caught(
      telegramSendNode.run(
        ctx({ connectionId: "c1", chatId: "0", text: "x", parseMode: "HTML" as const }, CREDENTIAL),
      ),
    );
    expect(fatal.status).toBe(400);
    expect(fatal.message).toMatch(/chat not found/);

    vi.unstubAllGlobals();
    reply({ ok: false, description: "Bad Gateway" }, { status: 502 });
    const transient = await caught(
      telegramSendNode.run(
        ctx({ connectionId: "c1", chatId: "7", text: "x", parseMode: "HTML" as const }, CREDENTIAL),
      ),
    );
    expect(transient.status).toBe(502);
  });

  it("refuses a connection with no bot token", async () => {
    const fetchMock = mockFetch(async () => new Response("{}"));
    const error = await caught(
      telegramSendNode.run(
        ctx({ connectionId: "c1", chatId: "7", text: "x", parseMode: "HTML" as const }, { provider: "telegram" }),
      ),
    );
    expect(error.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
