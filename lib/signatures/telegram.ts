// Telegram does not sign its updates. Instead `setWebhook` takes a `secret_token` that the Bot API
// echoes back on every delivery in `X-Telegram-Bot-Api-Secret-Token`
// (docs/research/connectors-chat.md; Bot API 10.3, unchanged in 2026).
//
// So "verification" is a shared-secret comparison, which makes the constant-time part the whole
// point: the token is ours, it is long-lived, and a naive `!==` leaks it a character at a time.
import { safeEqual } from "./timing";

/**
 * @param headerValue `request.headers.get("x-telegram-bot-api-secret-token")` — null when absent.
 * @param secretToken the token stored inside this connection's sealed secret.
 */
export function verifyTelegram(headerValue: string | null, secretToken: string): boolean {
  // An empty stored token would otherwise make a missing header look valid.
  if (!headerValue || !secretToken) return false;
  return safeEqual(headerValue, secretToken);
}
