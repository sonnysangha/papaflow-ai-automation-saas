---
description: Use when the goal is to send a Telegram message, alert or reply to a chat.
---

# Sending Telegram messages

`telegram_send` sends as the connected bot.

- `chatId` is a numeric chat id, or an `@channelname` the bot administers. A Telegram bot only knows
  a chat once someone has written to it, so ids that came with the goal (the chat that triggered this
  run, for instance) are the reliable ones.
- `parseMode` defaults to `HTML`. Telegram rejects the whole message when the markup does not parse,
  so use `"none"` for text containing `<`, `>` or `&` that is not meant as markup.

Keep messages short: Telegram truncates at 4096 characters.
