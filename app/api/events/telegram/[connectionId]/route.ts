import { updateConnectionMeta } from "@/lib/engine-client";
import { fanOut, loadConnection } from "@/lib/inbound";
import { verifyTelegram } from "@/lib/signatures/telegram";

/**
 * `POST /api/events/telegram/:connectionId` — every update the connected bot receives.
 *
 * The URL is per connection because the credential is: `connectors/telegram.ts#afterCreate` called
 * `setWebhook` with this exact URL and a generated `secret_token`, which Telegram echoes in
 * `X-Telegram-Bot-Api-Secret-Token` on every delivery. That header is the whole verification —
 * Telegram signs nothing — so it is compared in constant time against the token sealed inside this
 * connection's secret (`lib/signatures/telegram.ts`).
 *
 * Telegram gives a webhook a short deadline and retries anything that is not a 2xx, so the answer
 * is always 200 once the token has proved the caller: an update this build does not act on is not
 * an error, and a redelivery of it would not help. `started` says how many runs it began.
 *
 * Node runtime: the vault and the constant-time compare are `node:crypto`.
 */
export const runtime = "nodejs";

const TRIGGER_TYPE = "telegram.message";

type RouteContext = { params: Promise<{ connectionId: string }> };

/** The slice of a Bot API update this route reads. Everything else rides along in `update`. */
type TelegramChat = { id?: unknown; type?: unknown; title?: unknown; first_name?: unknown };
type TelegramMessage = { chat?: TelegramChat; text?: unknown; from?: unknown };
type TelegramUpdate = { message?: TelegramMessage; callback_query?: { message?: TelegramMessage } };

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
 * worth learning even though nothing acts on the button press yet (Phase 8).
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

  // Only messages start runs today. A `callback_query` is learned from and acknowledged; acting on
  // one needs the Approval buttons that arrive in Phase 8.
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
