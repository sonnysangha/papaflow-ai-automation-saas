---
description: Use when the workflow has to post, notify, announce or message someone — Slack, Discord, Telegram or Teams.
---

# Sending a message

Four connectors, one shape: a connection plus a destination plus text.

- **`slack.postMessage`** — `channel` takes a channel id, `#name` or a user id for a DM. `text` is
  the message and also what Slack shows in notifications, so write a sentence even when you add
  Block Kit `blocks`.
- **`discord.postMessage`** — a webhook connection always posts to its own channel; a bot connection needs
  `channelId`.
- **`telegram.sendMessage`** — `chatId` is a numeric chat id or an `@channel` the bot can already reach.
- **`teams.postCard`** — posts through a Workflows webhook; it cannot show buttons.

All four need a connection (`connectionId`) and all four are Pro connectors. Ask the user which
channel; never guess one, and never post to `#general` because it was the only name you knew.

For an approval that a person clicks, use `logic.approval` instead — it is the node that waits.
