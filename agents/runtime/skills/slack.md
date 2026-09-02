---
description: Use when the goal is to post, announce, notify or share something in Slack.
---

# Posting to Slack

`slack_post` writes into one Slack workspace as the connected bot. Only that workspace — if the goal
names a different one, say so instead of posting.

- `channel` takes a channel id (`C0123ABCD`), a `#name`, or a user id for a DM. Use whatever the goal
  gave you verbatim; do not translate a name into an id you guessed.
- `text` is the message. It is also what Slack shows in notifications, so write it as a sentence even
  when you add blocks.
- `blocks` is optional Block Kit JSON, as a JSON array in a string. Skip it unless the goal asks for
  formatting Slack markdown cannot express.

Slack refuses with words, not status codes: `channel_not_found` means the id is wrong,
`not_in_channel` means the bot has not been invited. Both need a person — report them and stop.
