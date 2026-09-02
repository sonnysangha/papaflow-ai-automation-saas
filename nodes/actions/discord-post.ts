import { z } from "zod";

import { discordWebhookEndpoint, parseDiscordWebhookUrl } from "@/connectors/discord-webhook";
import { ConnectorError, defineNode } from "../define";

/**
 * Post to Discord through whichever kind of Discord connection the node was pointed at.
 *
 * `credential: "discord"` is a family rather than one provider: a webhook connection posts to the
 * single channel its URL was created for, a bot connection posts to any channel it can see. Both
 * take the same message, so they are one node with one branch inside `run` — `credential.provider`
 * is what `runNode` puts there, and it is the only thing that distinguishes them.
 *
 * Discord wants at least one of content / embeds, and refuses an empty message with a 400 that says
 * nothing useful, so the check happens here where the message can name the actual field.
 */

const BOT_API = "https://discord.com/api/v10";
/** "Unknown Webhook": the webhook was deleted. Retrying earns an IP restriction, so it is fatal. */
const UNKNOWN_WEBHOOK = 10015;

type DiscordFailure = { message?: unknown; code?: unknown; retry_after?: unknown };

function credentialString(credential: Record<string, unknown> | undefined, field: string): string {
  const value = credential?.[field];
  return typeof value === "string" ? value : "";
}

/** `{ title?, description?, url? }` — one embed, or nothing at all when no embed field was filled. */
function embedOf(inputs: {
  embedTitle?: string;
  embedDescription?: string;
  embedUrl?: string;
}): Record<string, string> | undefined {
  const embed: Record<string, string> = {};
  if (inputs.embedTitle) embed.title = inputs.embedTitle;
  if (inputs.embedDescription) embed.description = inputs.embedDescription;
  if (inputs.embedUrl) embed.url = inputs.embedUrl;
  return Object.keys(embed).length > 0 ? embed : undefined;
}

/** Turns any Discord refusal into the right `ConnectorError`. Never returns. */
async function refuse(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as DiscordFailure;
  const described = typeof body.message === "string" ? body.message : `HTTP ${response.status}`;

  if (response.status === 429) {
    // Discord reports the wait in the JSON body as seconds, not in a `Retry-After` header.
    const seconds = typeof body.retry_after === "number" ? String(body.retry_after) : undefined;
    throw new ConnectorError("Discord rate limit reached.", 429, seconds);
  }

  if (response.status === 404 && body.code === UNKNOWN_WEBHOOK) {
    throw new ConnectorError(
      "Discord no longer knows this webhook — it was deleted. Reconnect it.",
      404,
    );
  }

  throw new ConnectorError(`Discord refused the message: ${described}`, response.status);
}

export const discordPostNode = defineNode({
  type: "discord.postMessage",
  name: "Discord: Post message",
  description: "Post a message or embed to Discord, through a webhook or a bot.",
  category: "chat",
  icon: "MessagesSquare",
  credential: "discord",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    channelId: z
      .string()
      .optional()
      .meta({ picker: "channels" })
      .describe("Bot connections only — a webhook always posts to its own channel"),
    content: z.string().optional(),
    embedTitle: z.string().optional(),
    embedDescription: z.string().optional(),
    embedUrl: z.string().optional(),
  }),
  outputs: z.object({ id: z.string() }),
  async run({ inputs, credential }) {
    const embed = embedOf(inputs);
    if (!inputs.content && !embed) {
      throw new ConnectorError("Fill in content, or at least one embed field.", 400);
    }

    const payload = {
      ...(inputs.content ? { content: inputs.content } : {}),
      ...(embed ? { embeds: [embed] } : {}),
    };

    const provider = credentialString(credential, "provider");
    const request =
      provider === "discord-bot"
        ? botRequest(credential, inputs.channelId)
        : webhookRequest(credential);

    const response = await fetch(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...request.headers },
      body: JSON.stringify(payload),
    });

    if (!response.ok) await refuse(response);

    const body = (await response.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) throw new ConnectorError("Discord accepted the message but returned no id.", 502);

    return { id };
  },
});

/** `?wait=true` makes Discord answer with the created message instead of an empty 204. */
function webhookRequest(credential: Record<string, unknown> | undefined): {
  url: string;
  headers: Record<string, string>;
} {
  const parsed = parseDiscordWebhookUrl(credentialString(credential, "webhookUrl"));
  if (!parsed) {
    throw new ConnectorError("This Discord connection has no usable webhook URL — reconnect it.", 400);
  }
  return { url: `${discordWebhookEndpoint(parsed.id, parsed.token)}?wait=true`, headers: {} };
}

function botRequest(
  credential: Record<string, unknown> | undefined,
  channelId: string | undefined,
): { url: string; headers: Record<string, string> } {
  const token = credentialString(credential, "botToken");
  if (!token) {
    throw new ConnectorError("This Discord connection has no bot token — reconnect it.", 400);
  }
  if (!channelId) {
    throw new ConnectorError("Choose a channel: a bot connection does not have one of its own.", 400);
  }
  return {
    url: `${BOT_API}/channels/${channelId}/messages`,
    headers: { Authorization: `Bot ${token}` },
  };
}
