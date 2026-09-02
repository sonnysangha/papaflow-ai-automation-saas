import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorError, type RunContext } from "@/nodes/define";
import {
  approvalCallbackId,
  approvalNode,
  parseApprovalCallback,
} from "@/nodes/logic/approval";
import { toJsonSchema } from "@/nodes/schema";

/**
 * The Approval node's three `run` paths, with every provider call mocked.
 *
 * What is asserted is the wire shape each chat app needs — Block Kit `value`, a component
 * `custom_id`, an inline keyboard's `callback_data` — and, above all, that all three carry the same
 * `approve:<stepId>` / `reject:<stepId>` pair. That string is the entire contract between this node
 * and the three resume routes; if it drifts on one provider, that provider's buttons stop working
 * silently.
 */

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

const SLACK_TOKEN = "xoxb-1111-2222-approvaltokenabcd";
const DISCORD_TOKEN = "MTIzNDU2Nzg5.Gabcde.approval-bot-token";
const TELEGRAM_TOKEN = "123456789:AAF-approval-token-abcdefghij";
const STEP_ID = "k17d9ab2c3e4f5g6h7i8j9k0l1m2n3o4";

type ApprovalInputs = {
  connectionId: string;
  target: string;
  message: string;
  approveLabel: string;
  rejectLabel: string;
};

function ctx(
  provider: string,
  botToken: string,
  overrides: Partial<RunContext<ApprovalInputs>> = {},
): RunContext<ApprovalInputs> {
  return {
    inputs: {
      connectionId: "cn_1",
      target: "C0123456789",
      message: "Ship release 4.2 to production?",
      approveLabel: "Ship it",
      rejectLabel: "Hold",
    },
    credential: { provider, kind: "botToken", botToken },
    orgId: "org_test",
    executionId: "exec_test",
    nodeId: "approval_1",
    hookToken: "exec_test:approval_1",
    stepId: STEP_ID,
    ...overrides,
  };
}

function mockFetch(impl: (...args: FetchArgs) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Answers every request with this JSON, so a test only has to say what came back. */
function reply(body: unknown, init: ResponseInit = {}) {
  return mockFetch(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
      }),
  );
}

/** The minimum a config panel would produce; `handles` does not read any of it. */
function defaults(): ApprovalInputs {
  return {
    connectionId: "cn_1",
    target: "C0123456789",
    message: "Ship it?",
    approveLabel: "Approve",
    rejectLabel: "Reject",
  };
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

async function caught(promise: Promise<unknown>): Promise<ConnectorError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the node run to reject");
    },
    (cause: unknown) => cause,
  );
  if (!(error instanceof ConnectorError)) {
    throw new Error(`expected a ConnectorError, got: ${String(error)}`);
  }
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("approval callback ids", () => {
  it("round-trips a decision and a step id", () => {
    expect(approvalCallbackId("approve", STEP_ID)).toBe(`approve:${STEP_ID}`);
    expect(parseApprovalCallback(`approve:${STEP_ID}`)).toEqual({
      approved: true,
      stepId: STEP_ID,
    });
    expect(parseApprovalCallback(`reject:${STEP_ID}`)).toEqual({
      approved: false,
      stepId: STEP_ID,
    });
  });

  it("stays inside Telegram's 64-byte callback_data limit", () => {
    const encoded = new TextEncoder().encode(approvalCallbackId("approve", STEP_ID));
    expect(encoded.length).toBeLessThanOrEqual(64);
  });

  it("refuses anything this node did not send", () => {
    expect(parseApprovalCallback("maybe:st_1")).toBeNull();
    expect(parseApprovalCallback("approve:")).toBeNull();
    expect(parseApprovalCallback("approve")).toBeNull();
    expect(parseApprovalCallback("")).toBeNull();
    expect(parseApprovalCallback(undefined)).toBeNull();
    expect(parseApprovalCallback(42)).toBeNull();
  });
});

describe("logic.approval", () => {
  it("declares the provider-agnostic picker and both branches", () => {
    const schema = toJsonSchema(approvalNode.inputs);
    const properties = (schema.properties ?? {}) as Record<string, { picker?: unknown }>;

    expect(properties.target?.picker).toBe("targets");
    expect(approvalNode.credential).toBe("chat");
    expect(approvalNode.handles?.(approvalNode.inputs.parse({ ...defaults() }))).toEqual([
      "approved",
      "rejected",
    ]);
    // Every run suspends: the answer arrives from outside, never from `run`.
    expect(approvalNode.control?.({ posted: true, provider: "slack" })).toEqual({ kind: "hook" });
  });

  it("posts Slack Block Kit buttons whose values carry the step id", async () => {
    const fetchMock = reply({ ok: true, ts: "1700000000.000100", channel: "C0123456789" });

    const output = await approvalNode.run(ctx("slack", SLACK_TOKEN));
    expect(output).toEqual({ posted: true, provider: "slack" });

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(headersOf(init).Authorization).toBe(`Bearer ${SLACK_TOKEN}`);

    const body = bodyOf(init);
    expect(body.channel).toBe("C0123456789");
    // `text` stays beside `blocks`: it is the notification and the screen-reader fallback.
    expect(body.text).toBe("Ship release 4.2 to production?");

    const blocks = body.blocks as { type: string; elements?: Record<string, unknown>[] }[];
    const actions = blocks.find((block) => block.type === "actions");
    expect(actions?.elements).toHaveLength(2);
    expect(actions?.elements?.[0]).toMatchObject({
      action_id: "approve",
      style: "primary",
      value: `approve:${STEP_ID}`,
      text: { type: "plain_text", text: "Ship it" },
    });
    expect(actions?.elements?.[1]).toMatchObject({
      action_id: "reject",
      style: "danger",
      value: `reject:${STEP_ID}`,
      text: { type: "plain_text", text: "Hold" },
    });
  });

  it("posts a Discord component row whose custom_ids carry the step id", async () => {
    const fetchMock = reply({ id: "1234567890" });

    const output = await approvalNode.run(
      ctx("discord-bot", DISCORD_TOKEN, {
        inputs: {
          connectionId: "cn_1",
          target: "987654321098765432",
          message: "Ship release 4.2 to production?",
          approveLabel: "Ship it",
          rejectLabel: "Hold",
        },
      }),
    );
    expect(output).toEqual({ posted: true, provider: "discord-bot" });

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe("https://discord.com/api/v10/channels/987654321098765432/messages");
    expect(headersOf(init).Authorization).toBe(`Bot ${DISCORD_TOKEN}`);

    const body = bodyOf(init);
    expect(body.content).toBe("Ship release 4.2 to production?");

    const rows = body.components as { type: number; components: Record<string, unknown>[] }[];
    expect(rows[0].type).toBe(1);
    // Button type 2; style 3 is green (success) and 4 is red (danger).
    expect(rows[0].components[0]).toEqual({
      type: 2,
      style: 3,
      label: "Ship it",
      custom_id: `approve:${STEP_ID}`,
    });
    expect(rows[0].components[1]).toEqual({
      type: 2,
      style: 4,
      label: "Hold",
      custom_id: `reject:${STEP_ID}`,
    });
  });

  it("posts a Telegram inline keyboard whose callback_data carries the step id", async () => {
    const fetchMock = reply({ ok: true, result: { message_id: 12 } });

    const output = await approvalNode.run(
      ctx("telegram", TELEGRAM_TOKEN, {
        inputs: {
          connectionId: "cn_1",
          target: "-1001234567890",
          message: "Ship release 4.2 to production?",
          approveLabel: "Ship it",
          rejectLabel: "Hold",
        },
      }),
    );
    expect(output).toEqual({ posted: true, provider: "telegram" });

    const [url, init] = fetchMock.mock.calls[0] as FetchArgs;
    expect(url).toBe(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`);

    const body = bodyOf(init);
    expect(body.chat_id).toBe("-1001234567890");
    expect(body.text).toBe("Ship release 4.2 to production?");
    expect(body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "Ship it", callback_data: `approve:${STEP_ID}` },
          { text: "Hold", callback_data: `reject:${STEP_ID}` },
        ],
      ],
    });
  });

  it("refuses a connection that is not one of the three button-capable chat apps", async () => {
    const fetchMock = reply({});

    const error = await caught(approvalNode.run(ctx("discord-webhook", "some-token")));
    expect(error.status).toBe(400);
    expect(error.message).toContain("discord-webhook");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to post without a bot token or without a step to resume", async () => {
    const fetchMock = reply({});

    const noToken = await caught(approvalNode.run(ctx("slack", "")));
    expect(noToken.status).toBe(400);

    const noStep = await caught(approvalNode.run(ctx("slack", SLACK_TOKEN, { stepId: undefined })));
    expect(noStep.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps each provider's refusal onto the retry policy runNode expects", async () => {
    reply({ ok: false, error: "channel_not_found" });
    const slack = await caught(approvalNode.run(ctx("slack", SLACK_TOKEN)));
    // Slack answers 200 with `{ ok: false }`: configuration, so no retries.
    expect(slack.status).toBe(400);
    expect(slack.message).toContain("channel_not_found");

    reply({ retry_after: 3.5 }, { status: 429 });
    const discord = await caught(approvalNode.run(ctx("discord-bot", DISCORD_TOKEN)));
    expect(discord.status).toBe(429);
    expect(discord.retryAfter).toBe("3.5");

    reply({ ok: false, description: "chat not found" }, { status: 400 });
    const telegram = await caught(approvalNode.run(ctx("telegram", TELEGRAM_TOKEN)));
    expect(telegram.status).toBe(400);

    reply({ ok: false, description: "Bad Gateway" }, { status: 502 });
    const telegramDown = await caught(approvalNode.run(ctx("telegram", TELEGRAM_TOKEN)));
    // Telegram's own outage: worth the default three retries.
    expect(telegramDown.status).toBe(502);
  });

  it("never puts the bot token in an error message", async () => {
    reply({ ok: false, error: "invalid_auth" });
    const slack = await caught(approvalNode.run(ctx("slack", SLACK_TOKEN)));
    expect(slack.message).not.toContain(SLACK_TOKEN);

    reply({ ok: false, description: "Unauthorized" }, { status: 401 });
    const telegram = await caught(approvalNode.run(ctx("telegram", TELEGRAM_TOKEN)));
    // Telegram's token is in the URL, which is exactly why no failure path echoes it.
    expect(telegram.message).not.toContain(TELEGRAM_TOKEN);
  });
});
