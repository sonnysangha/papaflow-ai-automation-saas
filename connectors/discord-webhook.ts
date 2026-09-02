// The zero-friction way into Discord: a channel's own webhook URL, created in Discord's UI with no
// app, no bot and no invite. The URL *is* the credential — it carries the token — so it is sealed
// like any other secret and only ever leaves as the four-character hint.
//
// One webhook posts to exactly one channel, which is why this connector has no channel picker:
// the channel was chosen when the URL was created. `connectors/discord-bot.ts` is the other half,
// for workflows that need to choose a channel at run time.
import { defineConnector } from "./define";

const TIMEOUT_MS = 15_000;

/**
 * Both the id and the token off a pasted webhook URL. Discord hands users
 * `https://discord.com/api/webhooks/{id}/{token}`, but older copies say `discordapp.com` and some
 * say `/api/v10/`, so the path is matched rather than the whole URL.
 */
export function parseDiscordWebhookUrl(url: string): { id: string; token: string } | null {
  const match = /\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)/.exec(url.trim());
  if (!match) return null;
  return { id: match[1], token: match[2] };
}

/** The canonical form of a pasted URL — what we call, whatever the user copied. */
export function discordWebhookEndpoint(id: string, token: string): string {
  return `https://discord.com/api/webhooks/${id}/${token}`;
}

type WebhookPayload = { id?: unknown; name?: unknown; channel_id?: unknown; guild_id?: unknown };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const discordWebhookConnector = defineConnector({
  provider: "discord-webhook",
  name: "Discord Webhook",
  category: "chat",
  kind: "webhookUrl",
  requiresFeature: null,
  fields: [
    {
      name: "webhookUrl",
      label: "Webhook URL",
      kind: "url",
      placeholder: "https://discord.com/api/webhooks/…",
      help: "Channel → Edit Channel → Integrations → Webhooks → Copy Webhook URL",
    },
  ],
  docsUrl: "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
  icon: "Webhook",

  /**
   * A `GET` on the webhook itself needs no auth and answers with the webhook's own record, which
   * both proves the URL is live and gives the channel it posts to. A 404 here is Discord's code
   * 10015 — the webhook was deleted — and there is nothing to retry.
   */
  async test(secret) {
    const raw = secret.webhookUrl?.trim();
    if (!raw) return { ok: false, error: "Paste the webhook URL Discord gave you." };

    const parsed = parseDiscordWebhookUrl(raw);
    if (!parsed) {
      return {
        ok: false,
        error: "That does not look like a Discord webhook URL (https://discord.com/api/webhooks/…).",
      };
    }

    let response: Response;
    try {
      response = await fetch(discordWebhookEndpoint(parsed.id, parsed.token), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: "Could not reach Discord. Check your connection and try again." };
    }

    if (response.status === 404) {
      return { ok: false, error: "Discord does not know that webhook — it may have been deleted." };
    }
    if (!response.ok) {
      return { ok: false, error: `Discord refused the request: HTTP ${response.status}` };
    }

    const payload = (await response.json().catch(() => ({}))) as WebhookPayload;
    const name = asString(payload.name);
    const channelId = asString(payload.channel_id);

    return {
      ok: true,
      label: name ? `#${name}` : "Discord webhook",
      // The token is the secret half of the URL, so the hint comes off the token, not the URL.
      hint: parsed.token.slice(-4),
      meta: {
        channel_id: channelId,
        guild_id: asString(payload.guild_id),
        name,
        webhook_id: parsed.id,
      },
    };
  },
});
