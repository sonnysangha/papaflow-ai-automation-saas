import { z } from "zod";

import { ConnectorError, defineNode } from "../define";

/**
 * Post to a Slack channel as the connected bot.
 *
 * `channel` carries `picker: "channels"`, which is what turns it into a dropdown in the config
 * panel: the panel posts the node's `connectionId` to `/api/connections/[id]/pick`, the Slack
 * connector lists `conversations.list` server-side, and only ids and `#names` come back. A typed
 * id or a `{{ template }}` is still accepted — Slack takes `C0123…`, `#general` or a user id.
 *
 * Slack answers `200 { ok: false, error: "channel_not_found" }` for most refusals, so the body is
 * what decides, not the status line — except for 429, where `Retry-After` is the whole point
 * (CLAUDE.md rule 7 maps it to a `RetryableError`).
 */

const ENDPOINT = "https://slack.com/api/chat.postMessage";

function botToken(credential: Record<string, unknown> | undefined): string {
  const token = credential?.botToken;
  if (typeof token !== "string" || !token) {
    throw new ConnectorError("This Slack connection has no bot token — reconnect it.", 400);
  }
  return token;
}

/** Block Kit is typed as JSON text, so a mistyped bracket is a configuration error, not a 500. */
function parseBlocks(blocks: string | undefined): unknown[] | undefined {
  if (blocks === undefined || blocks.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(blocks);
  } catch {
    throw new ConnectorError("blocks must be valid JSON (a Block Kit array).", 400);
  }
  if (!Array.isArray(parsed)) {
    throw new ConnectorError("blocks must be a JSON array of Block Kit blocks.", 400);
  }
  return parsed;
}

export const slackPostNode = defineNode({
  type: "slack.postMessage",
  name: "Slack: Post message",
  description: "Post a message to a Slack channel as your bot.",
  category: "chat",
  icon: "Hash",
  credential: "slack",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    channel: z.string().meta({ picker: "channels" }),
    text: z.string().min(1),
    blocks: z.string().optional().describe("Optional Block Kit JSON"),
  }),
  outputs: z.object({ ts: z.string(), channel: z.string() }),
  async run({ inputs, credential }) {
    const token = botToken(credential);
    const blocks = parseBlocks(inputs.blocks);

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: inputs.channel,
        // `text` stays even with blocks: it is the notification and accessibility fallback.
        text: inputs.text,
        ...(blocks ? { blocks } : {}),
      }),
    });

    if (response.status === 429) {
      throw new ConnectorError(
        "Slack rate limit reached for this channel.",
        429,
        response.headers.get("retry-after") ?? undefined,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: unknown;
      ts?: unknown;
      channel?: unknown;
    };

    if (payload.ok !== true) {
      const described = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      // Slack's refusals are configuration problems (`channel_not_found`, `not_in_channel`,
      // `invalid_auth`), so they are fatal whatever the status line said.
      throw new ConnectorError(`Slack refused the message: ${described}`, 400);
    }

    const ts = typeof payload.ts === "string" ? payload.ts : "";
    const channel = typeof payload.channel === "string" ? payload.channel : inputs.channel;
    if (!ts) throw new ConnectorError("Slack accepted the message but returned no timestamp.", 502);

    return { ts, channel };
  },
});
