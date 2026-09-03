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
/** `GET /guilds/{id}/members` takes 1–1000; one page per guild is as far as a dropdown should go. */
const MEMBER_PAGE_SIZE = 200;

/**
 * What a picked *person* looks like in a node's target field, as opposed to a picked channel.
 *
 * Discord ids are snowflakes and nothing about one says whether it is a channel or a user, so a
 * target has to say which it is or the node would have to guess — and guessing wrong means posting
 * a private approval into a channel. Slack and Telegram need no equivalent: Slack's `chat.postMessage`
 * takes `C…` and `U…` in the same argument and opens the DM itself, and every Telegram chat id is
 * already a chat.
 */
export const DISCORD_USER_PREFIX = "user:";

/** The user id inside a `user:<id>` target, or `null` for a target that names a channel. */
export function discordUserId(target: string): string | null {
  if (!target.startsWith(DISCORD_USER_PREFIX)) return null;
  const id = target.slice(DISCORD_USER_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

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
 *
 * `send` is what makes the request a POST: everything the picker needs is a GET, and opening a DM
 * is the one call here that writes.
 */
async function callDiscord(
  token: string,
  path: string,
  send?: unknown,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string; status: number }> {
  let response: Response;
  try {
    response = await fetch(`${DISCORD_API}${path}`, {
      method: send === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bot ${token}`,
        ...(send === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(send === undefined ? {} : { body: JSON.stringify(send) }),
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

/**
 * The people in one guild, as `user:<id>` options — best effort, on purpose.
 *
 * `GET /guilds/{id}/members` "requires the `GUILD_MEMBERS` Privileged Intent"
 * (docs.discord.com/developers/resources/guild), which is a switch on the Bot page of the
 * Developer Portal that nobody has flicked by default. Without it Discord answers 403, and there is
 * no other way to enumerate members — so a refusal here is a guild that contributes no DM options
 * rather than a picker that fails. Typing `user:<id>` by hand always works, intent or not, because
 * opening a DM needs no permission at all.
 */
async function guildPeople(token: string, guildId: string): Promise<{ id: string; label: string }[]> {
  const result = await callDiscord(token, `/guilds/${guildId}/members?limit=${MEMBER_PAGE_SIZE}`);
  if (!result.ok) return [];

  const options: { id: string; label: string }[] = [];
  for (const member of asObjects(result.body)) {
    const user = member.user;
    if (typeof user !== "object" || user === null) continue;

    const person = user as Record<string, unknown>;
    // Other bots are members like anyone else, and a bot cannot DM a bot.
    if (person.bot === true) continue;

    const id = asString(person.id);
    if (!id) continue;

    // No server name on a DM option, unlike a channel's: the conversation is not in a server, and
    // the same person shows up in every server the bot shares with them.
    const handle = asString(person.username);
    const named = asString(member.nick) || asString(person.global_name) || handle || id;
    const label = handle && handle !== named ? `${named} (@${handle})` : named;
    options.push({ id: `${DISCORD_USER_PREFIX}${id}`, label: `DM · ${label}` });
  }
  return options;
}

/**
 * The DM channel between the bot and one person, opened if it was not already.
 *
 * `POST /users/@me/channels { recipient_id }` → a channel object whose `id` takes messages exactly
 * like a guild channel's does (docs.discord.com/developers/resources/user). Discord asks callers not
 * to do this in bulk — "if you open a significant amount of DMs too quickly, your bot may be rate
 * limited or blocked from opening new ones" — which is why it happens once per node run, from a
 * target a person chose, and never while building a list.
 *
 * Returns a result rather than throwing so the caller can decide: `connectors/` cannot import
 * `nodes/define`, and a `ConnectorError` is what the two callers there need.
 */
export async function openDiscordDm(
  token: string,
  userId: string,
): Promise<{ ok: true; channelId: string } | { ok: false; status: number; error: string }> {
  const result = await callDiscord(token, "/users/@me/channels", { recipient_id: userId });
  if (!result.ok) return { ok: false, status: result.status, error: result.error };

  const channelId = asString((result.body as Record<string, unknown> | null)?.id);
  if (!channelId) {
    return { ok: false, status: 502, error: "Discord opened no DM channel for that user." };
  }
  return { ok: true, channelId };
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
   * `"guilds"` lists the servers the bot was invited to; `"channels:<guildId>"` narrows to the
   * channels of one of them. Plain `"channels"` — what a node asks for when it does not know about
   * guilds — walks the first few guilds and suffixes each channel with its server, because
   * `#general` on its own is ambiguous the moment a bot is in two servers, and then appends the
   * people it can see as `user:<id>` options so a workflow can DM them.
   *
   * People are deduplicated across servers: the value is the person, not the place, so a member of
   * two of the bot's servers is one option and not two.
   */
  async pick(rawKind, secret) {
    const token = secret.botToken?.trim() ?? "";
    // The Approval node asks every chat provider for `targets`; here that means "a channel the bot
    // can post in, or a person it can DM", which is exactly the un-scoped list.
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

    const channels: { id: string; label: string }[] = [];
    const people = new Map<string, string>();

    for (const guild of asObjects(guilds.body).slice(0, MAX_GUILDS)) {
      const guildId = asString(guild.id);
      if (!guildId) continue;
      const name = asString(guild.name);
      channels.push(...(await textChannels(token, guildId, name ? ` · ${name}` : "")));
      for (const person of await guildPeople(token, guildId)) {
        if (!people.has(person.id)) people.set(person.id, person.label);
      }
    }

    return [...channels, ...[...people].map(([id, label]) => ({ id, label }))];
  },

  /**
   * A bot that is in no server sees nothing at all — not even people, since members are only
   * visible through a server it shares with them.
   */
  emptyHint(kind) {
    if (kind !== "channels" && kind !== TARGETS_PICKER) return null;
    return (
      "Invite the bot to the server, then reload. People are only listed once the Server Members " +
      "Intent is on for the app; without it, type user:<their Discord id> to DM someone."
    );
  },
});
