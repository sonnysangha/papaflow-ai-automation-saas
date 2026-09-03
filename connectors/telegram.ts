// Telegram bots are connected by pasting the token @BotFather printed. `getMe` validates it and
// tells us who the bot is; `setWebhook` then points Telegram at this connection's own inbound URL
// with a generated `secret_token` it will echo in `X-Telegram-Bot-Api-Secret-Token`
// (docs/research/connectors-chat.md — HTTPS only, ports 443/80/88/8443).
//
// The generated token is stored *inside* the sealed secret rather than in `meta`: `meta` is
// projected to the client by the connections list, and this value is what authenticates every
// inbound update (CLAUDE.md rule 1).
import { defineConnector, TARGETS_PICKER } from "./define";

const TIMEOUT_MS = 15_000;

/** Which updates a trigger can act on. Anything else Telegram would send is not worth the request. */
const ALLOWED_UPDATES = ["message", "callback_query"] as const;

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

type TelegramResponse = { ok?: boolean; result?: Record<string, unknown>; description?: string };

/** Every Bot API answer is `{ ok, result }` or `{ ok: false, description }`, including on a 4xx. */
async function callBotApi(
  token: string,
  method: string,
  body?: unknown,
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(api(token, method), {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // The token never reaches a log line, and neither does the URL that contains it.
    return { ok: false, error: "Could not reach Telegram. Check your connection and try again." };
  }

  const payload = (await response.json().catch(() => ({}))) as TelegramResponse;
  if (!response.ok || payload.ok !== true) {
    const described = typeof payload.description === "string" ? payload.description : `HTTP ${response.status}`;
    return {
      ok: false,
      error: response.status === 401 ? "Telegram rejected that bot token." : `Telegram refused the request: ${described}`,
    };
  }

  return { ok: true, result: payload.result ?? {} };
}

/** 24 random bytes → exactly 32 base64url characters, well inside Telegram's 1-256 char limit. */
function generateSecretToken(): string {
  // Web Crypto rather than `node:crypto`: this module is reachable from the node registry, which
  // the Workflow SDK bundles into the workflow function, and its bundler refuses Node built-ins.
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A chat learned from an inbound update, as the route stores it in `meta.chat_ids`.
 *
 * `title` is what a group, supergroup or channel is called; the other three are what a *private*
 * chat carries instead (core.telegram.org/bots/api — a private chat has `first_name`, and
 * optionally `last_name` and `username`, and never a `title`). Every field is optional here because
 * rows written before a field existed are still in `meta`, and a chat nobody can name is still a
 * chat the bot can post to.
 */
type KnownChat = {
  id: unknown;
  type?: unknown;
  title?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
};

/** Telegram's own name for a one-to-one chat between the bot and a person. */
const PRIVATE_CHAT = "private";

function knownChats(meta: Record<string, unknown>): KnownChat[] {
  const chats = meta.chat_ids;
  if (!Array.isArray(chats)) return [];
  return chats.filter((chat): chat is KnownChat => typeof chat === "object" && chat !== null);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isDirectMessage(chat: KnownChat): boolean {
  // `type` is the answer whenever the route recorded one. A chat learned before it did is a DM if
  // it is named the way only a private chat is: `first_name` with no `title`.
  if (typeof chat.type === "string") return chat.type === PRIVATE_CHAT;
  return text(chat.first_name).length > 0 && text(chat.title).length === 0;
}

/**
 * `DM · Sonny Sangha (@sonny)` for a person, the group's own title for everything else.
 *
 * The `DM ·` prefix is the point: a Telegram chat id says nothing about who is on the other end,
 * and "Sonny" sitting between two group names reads like a third group. The `@username` is added
 * when there is one because two people can share a first name and nothing else in the list can tell
 * them apart. A chat stored before any of this had labels keeps its id, and stays selectable.
 */
function chatLabel(chat: KnownChat): string {
  const title = text(chat.title);
  if (title) return title;

  const named = [text(chat.first_name), text(chat.last_name)].filter(Boolean).join(" ");
  const handle = text(chat.username);
  if (!named && !handle) return String(chat.id);

  const who = named && handle ? `${named} (@${handle})` : named || `@${handle}`;
  return isDirectMessage(chat) ? `DM · ${who}` : who;
}

export const telegramConnector = defineConnector({
  provider: "telegram",
  name: "Telegram",
  category: "chat",
  kind: "botToken",
  requiresFeature: null,
  fields: [
    {
      name: "botToken",
      label: "Bot token",
      kind: "secret",
      placeholder: "123456789:AA…",
      help: "From @BotFather",
    },
  ],
  docsUrl: "https://core.telegram.org/bots/features#botfather",
  icon: "Send",

  async test(secret) {
    const token = secret.botToken?.trim();
    if (!token) return { ok: false, error: "Paste the bot token @BotFather gave you." };

    const result = await callBotApi(token, "getMe");
    if (!result.ok) return result;

    const username = typeof result.result.username === "string" ? result.result.username : "";
    if (!username) return { ok: false, error: "Telegram accepted the token but returned no bot username." };

    return {
      ok: true,
      label: `@${username}`,
      hint: token.slice(-4),
      meta: { bot_username: username, bot_id: result.result.id },
    };
  },

  /**
   * Registers the webhook now that the connection has an id — the URL contains it, so this cannot
   * happen during `test()`.
   *
   * Telegram only accepts HTTPS URLs, so a localhost `APP_ORIGIN` skips the call rather than
   * failing the whole create: the connection is still perfectly usable for sending (Phase 6), and
   * `meta.webhookSet === false` is what the UI reads to say "inbound needs a deployed URL".
   * A real refusal from Telegram *does* throw, so `createConnectionFromInput` rolls the row back
   * instead of leaving a connection whose triggers would silently never fire.
   */
  async afterCreate({ connectionId, secret, appOrigin }) {
    const token = secret.botToken?.trim() ?? "";
    const secretToken = generateSecretToken();
    const inboundUrl = `${appOrigin}/api/events/telegram/${connectionId}`;

    if (!appOrigin.startsWith("https://")) {
      return {
        secret: { ...secret, secretToken },
        meta: { webhookSet: false, webhookSkipped: "APP_ORIGIN is not https", inboundUrl },
      };
    }

    const result = await callBotApi(token, "setWebhook", {
      url: inboundUrl,
      secret_token: secretToken,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    if (!result.ok) throw new Error(`telegram: setWebhook failed — ${result.error}`);

    return { secret: { ...secret, secretToken }, meta: { webhookSet: true, inboundUrl } };
  },

  /**
   * Telegram has no "list my chats" endpoint: a bot only learns a chat exists when someone writes
   * to it. The inbound route records each one in `meta.chat_ids`, and this turns that into the
   * options the Send-message node's picker shows.
   *
   * DMs come first. A private chat is the one a person is most likely to be reaching for — "ask
   * *me* before you ship" — and it is also the one that looks least like an option in a list of
   * group titles, so it is labelled and sorted rather than left to be recognised by id. The order
   * within each half is the order the chats were learned in, which is stable.
   */
  async pick(kind, _secret, meta) {
    // `targets` is the Approval node's provider-agnostic kind; a Telegram "target" is a chat.
    if (kind !== "chats" && kind !== TARGETS_PICKER) return [];

    const chats = knownChats(meta);
    return [...chats.filter(isDirectMessage), ...chats.filter((chat) => !isDirectMessage(chat))].map(
      (chat) => ({ id: String(chat.id), label: chatLabel(chat) }),
    );
  },

  /**
   * The generic "invite the bot where it needs to post" is wrong here, and wrong in a way that
   * costs people an afternoon: a Telegram bot cannot be invited into a DM and cannot message
   * anybody who has not written to it first (core.telegram.org/bots/api). The chat has to come to
   * the bot, so that is what this says.
   */
  emptyHint(kind) {
    if (kind !== "chats" && kind !== TARGETS_PICKER) return null;
    return (
      "No chats yet. Open Telegram, send the bot any message (or /start) from the account or " +
      "group you want it to post in, then reload."
    );
  },
});
