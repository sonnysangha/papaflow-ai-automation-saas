import { z } from "zod";

import { ConnectorError, defineNode } from "../define";

/**
 * The outbound half of the Telegram connector: `sendMessage` with the bot token the connection
 * holds.
 *
 * A bot only learns a chat exists once someone writes to it, so `chatId` is a picker over
 * `meta.chat_ids` — the ids `app/api/events/telegram/[connectionId]` recorded — with a typed value
 * as the escape hatch for a channel (`@my_channel`) or an id copied from elsewhere.
 *
 * `parseMode` defaults to HTML because that is the format the rest of the app produces, and
 * `"none"` exists for text that contains `<`, `>` or `&` and is not meant as markup: Telegram
 * rejects the whole message with a 400 when the entities do not parse.
 */

const TIMEOUT_MS = 30_000;

type TelegramFailure = {
  ok?: boolean;
  description?: unknown;
  result?: { message_id?: unknown };
  parameters?: { retry_after?: unknown };
};

function botToken(credential: Record<string, unknown> | undefined): string {
  const token = credential?.botToken;
  if (typeof token !== "string" || !token) {
    throw new ConnectorError("This Telegram connection has no bot token — reconnect it.", 400);
  }
  return token;
}

export const telegramSendNode = defineNode({
  type: "telegram.sendMessage",
  name: "Telegram: Send message",
  description: "Send a message to a Telegram chat as your bot.",
  category: "chat",
  icon: "Send",
  credential: "telegram",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    chatId: z.string().meta({ picker: "chats" }),
    text: z.string().min(1),
    parseMode: z.enum(["HTML", "MarkdownV2", "none"]).default("HTML"),
  }),
  outputs: z.object({ messageId: z.number() }),
  async run({ inputs, credential }) {
    const token = botToken(credential);

    // The token is in the URL, which is why no failure path here ever echoes the URL back.
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: inputs.chatId,
        text: inputs.text,
        ...(inputs.parseMode === "none" ? {} : { parse_mode: inputs.parseMode }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => ({}))) as TelegramFailure;

    if (payload.ok !== true) {
      const described = typeof payload.description === "string" ? payload.description : `HTTP ${response.status}`;
      const retryAfter = payload.parameters?.retry_after;

      if (response.status === 429) {
        // Telegram puts the wait inside `parameters`, in seconds, rather than in a header.
        throw new ConnectorError(
          `Telegram rate limit reached: ${described}`,
          429,
          typeof retryAfter === "number" ? String(retryAfter) : undefined,
        );
      }

      throw new ConnectorError(
        `Telegram refused the message: ${described}`,
        // A 5xx is Telegram's problem and worth the default retries; everything else is the
        // configuration's (a wrong chat id, unparseable HTML) and must not be retried.
        response.status >= 500 ? response.status : 400,
      );
    }

    const messageId = payload.result?.message_id;
    if (typeof messageId !== "number") {
      throw new ConnectorError("Telegram accepted the message but returned no message id.", 502);
    }

    return { messageId };
  },
});
