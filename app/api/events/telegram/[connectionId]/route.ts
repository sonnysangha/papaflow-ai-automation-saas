import { updateConnectionMeta } from "@/lib/engine-client";
import { resumeByStepId } from "@/lib/hooks";
import { fanOut, loadConnection } from "@/lib/inbound";
import { verifyTelegram } from "@/lib/signatures/telegram";
import { parseApprovalCallback } from "@/nodes/logic/approval";

/**
 * `POST /api/events/telegram/:connectionId` — every update the connected bot receives.
 *
 * The URL is per connection because the credential is: `connectors/telegram.ts#afterCreate` called
 * `setWebhook` with this exact URL and a generated `secret_token`, which Telegram echoes in
 * `X-Telegram-Bot-Api-Secret-Token` on every delivery. That header is the whole verification —
 * Telegram signs nothing — so it is compared in constant time against the token sealed inside this
 * connection's secret (`lib/signatures/telegram.ts`).
 *
 * Two kinds of update do something here. A `message` starts every workflow whose `telegram.message`
 * trigger names this connection; a `callback_query` carrying `approve:<stepId>` / `reject:<stepId>`
 * is an Approval button being pressed, and resumes the one run waiting on it.
 *
 * Telegram gives a webhook a short deadline and retries anything that is not a 2xx, so the answer
 * is always 200 once the token has proved the caller: an update this build does not act on is not
 * an error, and a redelivery of it would not help. `started` says how many runs it began.
 *
 * Node runtime: the vault and the constant-time compare are `node:crypto`.
 */
export const runtime = "nodejs";

const TRIGGER_TYPE = "telegram.message";

/** Telegram's webhook deadline is short; the two tidy-up calls must not be what blows it. */
const CALLBACK_TIMEOUT_MS = 5_000;

type RouteContext = { params: Promise<{ connectionId: string }> };

/** The slice of a Bot API update this route reads. Everything else rides along in `update`. */
type TelegramChat = { id?: unknown; type?: unknown; title?: unknown; first_name?: unknown };
type TelegramMessage = { message_id?: unknown; chat?: TelegramChat; text?: unknown; from?: unknown };
type TelegramFrom = { username?: unknown; first_name?: unknown; id?: unknown };
type TelegramCallbackQuery = {
  id?: unknown;
  data?: unknown;
  from?: TelegramFrom;
  message?: TelegramMessage;
};
type TelegramUpdate = { message?: TelegramMessage; callback_query?: TelegramCallbackQuery };

/** A chat as `meta.chat_ids` stores it: what the Send-message picker needs, and nothing more. */
type KnownChat = { id: string; type?: string; title?: string; first_name?: string };

function fail(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The chat an update happened in. A `callback_query` carries its chat one level deeper, and it is
 * worth learning from either way — an Approval pressed in a group is how that group becomes
 * pickable in the Send-message node.
 */
function chatOf(update: TelegramUpdate): TelegramChat | null {
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  return chat && chat.id !== undefined && chat.id !== null ? chat : null;
}

/**
 * Ids are stringified on the way in: Telegram chat ids can exceed 52 bits, so a JSON number is not
 * safe to round-trip (docs/research/connectors-chat.md), and the picker offers strings anyway.
 */
function toKnownChat(chat: TelegramChat): KnownChat {
  return {
    id: String(chat.id),
    ...(typeof chat.type === "string" ? { type: chat.type } : {}),
    ...(typeof chat.title === "string" ? { title: chat.title } : {}),
    ...(typeof chat.first_name === "string" ? { first_name: chat.first_name } : {}),
  };
}

function storedChats(meta: Record<string, unknown>): KnownChat[] {
  const chats = meta.chat_ids;
  if (!Array.isArray(chats)) return [];
  return chats
    .filter(isRecord)
    .map((chat) => ({ ...chat, id: String(chat.id) }) as KnownChat)
    .filter((chat) => chat.id !== "undefined");
}

/**
 * Telegram has no "list my chats": a bot only learns a chat exists when someone writes to it, so
 * this is the only place `meta.chat_ids` is ever filled — and `connectors/telegram.ts#pick` turns
 * it into the options the Send-message node offers (Phase 6).
 *
 * A chat already on the row is left alone rather than rewritten, so a busy group costs one Convex
 * write in total instead of one per message. A failure is logged and swallowed: learning a chat is
 * a convenience, and losing it must not cost the delivery its 200.
 */
async function learnChat(
  connectionId: string,
  orgId: string,
  meta: Record<string, unknown>,
  chat: TelegramChat,
): Promise<void> {
  const learned = toKnownChat(chat);
  const known = storedChats(meta);
  if (known.some((entry) => entry.id === learned.id)) return;

  try {
    await updateConnectionMeta({
      connectionId,
      orgId,
      meta: { chat_ids: [...known, learned] },
    });
  } catch (cause) {
    console.error(`telegram: could not record chat ${learned.id}`, cause);
  }
}

/** Whoever pressed the button, as Telegram names them. */
function pressedBy(from: TelegramFrom | undefined): string {
  for (const value of [from?.username, from?.first_name]) {
    if (typeof value === "string" && value) return value;
  }
  return from?.id === undefined ? "someone" : String(from.id);
}

/**
 * Clears the spinner on the pressed button and takes the keyboard away, so the same approval cannot
 * be pressed twice — Telegram has no "replace the message" response the way Slack and Discord do,
 * so both are separate Bot API calls made after the run has already been resumed.
 *
 * Failures are logged, never surfaced: the run has resumed, and a stuck spinner is not worth
 * telling Telegram to redeliver the press. The token is in the URL, so no message here echoes it.
 */
async function closeButtons(
  token: string,
  callback: TelegramCallbackQuery,
  text: string,
): Promise<void> {
  const call = async (method: string, body: unknown): Promise<void> => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    });
    if (!response.ok) console.error(`telegram: ${method} answered ${response.status}`);
  };

  await call("answerCallbackQuery", { callback_query_id: String(callback.id ?? ""), text }).catch(
    (cause: unknown) => console.error("telegram: answerCallbackQuery failed", cause),
  );

  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (chatId === undefined || messageId === undefined) return;

  await call("editMessageReplyMarkup", {
    chat_id: String(chatId),
    message_id: messageId,
    // An empty keyboard is how the buttons go away without touching the message text.
    reply_markup: { inline_keyboard: [] },
  }).catch((cause: unknown) => console.error("telegram: editMessageReplyMarkup failed", cause));
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { connectionId } = await params;

  const connection = await loadConnection(connectionId, "telegram");
  if (!connection) return fail(404, "not_found", "No bot is listening at this URL.");

  const secretToken =
    typeof connection.secret.secretToken === "string" ? connection.secret.secretToken : "";
  if (!verifyTelegram(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), secretToken)) {
    return fail(401, "bad_secret_token", "This delivery did not come from Telegram.");
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    // Past the token check, so this is Telegram sending something this build cannot read. A retry
    // would send the same bytes, so it is logged and accepted rather than refused.
    console.error(`telegram: unreadable update body on connection ${connectionId}`);
    return Response.json({ ok: true, started: 0 });
  }

  const chat = chatOf(update);
  if (chat) await learnChat(connectionId, connection.orgId, connection.meta, chat);

  // An Approval button. Resume first (the run is what the presser is waiting on), then tidy the
  // message up. A `callback_query` this build did not send is acknowledged and ignored.
  const callbackQuery = update.callback_query;
  const callback = callbackQuery ? parseApprovalCallback(callbackQuery.data) : null;
  if (callbackQuery && callback) {
    const by = pressedBy(callbackQuery.from);
    const botToken =
      typeof connection.secret.botToken === "string" ? connection.secret.botToken : "";

    let resumed = false;
    try {
      const result = await resumeByStepId(
        callback.stepId,
        {
          approved: callback.approved,
          by,
          provider: "telegram",
          // `runGraph` follows a resumed payload's `handle` over the node's own.
          handle: callback.approved ? "approved" : "rejected",
        },
        connection.orgId,
      );
      resumed = result.ok;
    } catch (cause) {
      console.error("telegram: could not resume the run", cause);
    }

    if (botToken) {
      const answer = resumed
        ? callback.approved
          ? `✅ Approved by ${by}`
          : `❌ Rejected by ${by}`
        : "This approval is no longer waiting.";
      await closeButtons(botToken, callbackQuery, answer);
    }

    return Response.json({ ok: true, resumed });
  }

  // Only messages start runs.
  const message = update.message;
  if (!message || !chat) return Response.json({ ok: true, started: 0 });

  const started = await fanOut({
    orgId: connection.orgId,
    triggerType: TRIGGER_TYPE,
    connectionId,
    trigger: {
      type: "telegram",
      payload: {
        update,
        chatId: String(chat.id),
        ...(typeof message.text === "string" ? { text: message.text } : {}),
        from: message.from ?? null,
      },
    },
  });

  return Response.json({ ok: true, started: started.length });
}
