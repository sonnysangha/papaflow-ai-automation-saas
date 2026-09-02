// A real Discord application: the bot token posts to any channel it can see, and the application id
// plus public key are what Phase 8's interactions endpoint needs to answer buttons and slash
// commands. Those two are not secrets (the public key is published in Discord's own dashboard), but
// they are typed on the same form and stored in the same envelope; `meta` carries them back out so
// the UI can show the invite link without ever opening the secret.
//
// Bots do not appear in a server until someone invites them, so `meta.inviteUrl` is the single most
// useful thing this connector produces — `test()` builds it from the application id the user pasted.
import { defineConnector, TARGETS_PICKER } from "./define";

const DISCORD_API = "https://discord.com/api/v10";
const TIMEOUT_MS = 15_000;

/** VIEW_CHANNEL (1 << 10) + SEND_MESSAGES (1 << 11). Embeds need 19456 — Phase 8 can widen it. */
const INVITE_PERMISSIONS = "3072";
/** `GUILD_TEXT`. Voice, categories and forums are not channels this node can post into. */
const TEXT_CHANNEL = 0;
/** Listing every channel of every guild is one request per guild; past this the picker is a search. */
const MAX_GUILDS = 10;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The invite users click to put the bot in their server. Public information by design. */
export function discordInviteUrl(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`;
}

type DiscordError = { message?: unknown; code?: unknown };

/**
 * Discord answers with real status codes and a JSON `{ message, code }` body. Unlike Slack, an
 * error is never a 200, so the status is what decides.
 */
async function callDiscord(
  token: string,
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string; status: number }> {
  let response: Response;
  try {
    response = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, error: "Could not reach Discord. Check your connection and try again." };
  }

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const described = asString((body as DiscordError).message) || `HTTP ${response.status}`;
    return {
      ok: false,
      status: response.status,
      error: response.status === 401 ? "Discord rejected that bot token." : `Discord refused the request: ${described}`,
    };
  }

  return { ok: true, body };
}

function asObjects(body: unknown): Record<string, unknown>[] {
  if (!Array.isArray(body)) return [];
  return body.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

/** `pick("channels:<guildId>")` — the guild half, or `null` for the un-scoped `"channels"`. */
function guildOf(kind: string): string | null {
  const [name, guildId] = kind.split(":", 2);
  return name === "channels" && guildId ? guildId : null;
}

async function textChannels(
  token: string,
  guildId: string,
  prefix: string,
): Promise<{ id: string; label: string }[]> {
  const result = await callDiscord(token, `/guilds/${guildId}/channels`);
  if (!result.ok) throw new Error(`discord: guild channels — ${result.error}`);

  return asObjects(result.body)
    .filter((channel) => channel.type === TEXT_CHANNEL)
    .map((channel) => ({ id: asString(channel.id), label: `#${asString(channel.name)}${prefix}` }))
    .filter((option) => option.id.length > 0);
}

export const discordBotConnector = defineConnector({
  provider: "discord-bot",
  name: "Discord Bot",
  category: "chat",
  kind: "botToken",
  requiresFeature: null,
  fields: [
    {
      name: "botToken",
      label: "Bot token",
      kind: "secret",
      placeholder: "MTIz…",
      help: "Developer Portal → your app → Bot → Reset Token",
    },
    {
      name: "applicationId",
      label: "Application ID",
      kind: "text",
      placeholder: "1234567890123456789",
      help: "General Information → Application ID. Used to build the invite link.",
    },
    {
      name: "publicKey",
      label: "Public key",
      kind: "text",
      required: false,
      placeholder: "Optional",
      help: "General Information → Public Key. Only needed for buttons and slash commands.",
    },
  ],
  docsUrl: "https://discord.com/developers/applications",
  icon: "Bot",

  /** `users/@me` with a `Bot` token is the identity call; everything else needs a guild first. */
  async test(secret) {
    const token = secret.botToken?.trim();
    if (!token) return { ok: false, error: "Paste the bot token from the Developer Portal." };

    const applicationId = secret.applicationId?.trim();
    if (!applicationId) return { ok: false, error: "Paste the application ID from General Information." };

    const result = await callDiscord(token, "/users/@me");
    if (!result.ok) return { ok: false, error: result.error };

    const me = (result.body ?? {}) as Record<string, unknown>;
    const username = asString(me.username);
    if (!username) return { ok: false, error: "Discord accepted the token but returned no bot username." };

    return {
      ok: true,
      label: username,
      hint: token.slice(-4),
      meta: {
        bot_id: asString(me.id),
        bot_username: username,
        // Non-secret, and the UI needs both: the invite link is built from the application id and
        // Phase 8 verifies interaction signatures against the public key.
        applicationId,
        publicKey: secret.publicKey?.trim() ?? "",
        inviteUrl: discordInviteUrl(applicationId),
      },
    };
  },

  /**
   * `"guilds"` lists the servers the bot was invited to; `"channels:<guildId>"` narrows to one of
   * them. Plain `"channels"` — what a node asks for when it does not know about guilds — walks the
   * first few guilds and suffixes each channel with its server, because `#general` on its own is
   * ambiguous the moment a bot is in two servers.
   */
  async pick(rawKind, secret) {
    const token = secret.botToken?.trim() ?? "";
    // The Approval node asks every chat provider for `targets`; here that means "a channel the bot
    // can post in", which is exactly the un-scoped channel list.
    const kind = rawKind === TARGETS_PICKER ? "channels" : rawKind;

    if (kind === "guilds") {
      const result = await callDiscord(token, "/users/@me/guilds");
      if (!result.ok) throw new Error(`discord: guilds — ${result.error}`);
      return asObjects(result.body)
        .map((guild) => ({ id: asString(guild.id), label: asString(guild.name) || asString(guild.id) }))
        .filter((option) => option.id.length > 0);
    }

    const scoped = guildOf(kind);
    if (scoped) return await textChannels(token, scoped, "");

    if (kind !== "channels") return [];

    const guilds = await callDiscord(token, "/users/@me/guilds");
    if (!guilds.ok) throw new Error(`discord: guilds — ${guilds.error}`);

    const options: { id: string; label: string }[] = [];
    for (const guild of asObjects(guilds.body).slice(0, MAX_GUILDS)) {
      const guildId = asString(guild.id);
      if (!guildId) continue;
      const name = asString(guild.name);
      options.push(...(await textChannels(token, guildId, name ? ` · ${name}` : "")));
    }
    return options;
  },
});
