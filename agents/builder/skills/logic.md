---
description: Use when the workflow has to branch, wait, repeat, reshape data, or pause for a human.
---

# Shaping the run

- **`logic.set`** — name a few fields and pass a tidy object on. The cheapest way to make the next
  node readable: one Set with `{{ … }}` values beats four long templates downstream.
- **`logic.condition`** — one comparison, two outputs: connect with `sourceHandle: "true"` and
  `"false"`. Wire both, or one branch simply ends.
- **`logic.switch`** — one value, one output per case plus `"default"`. The handle ids are the case
  strings exactly as you typed them.
- **`logic.wait`** — pauses the run for a duration. Nothing is running while it waits.
- **`logic.approval`** — posts buttons to a chat app and waits for a person to press one. Needs a
  Slack, Discord bot or Telegram connection; it is how "let someone check it first" is built.
- **`logic.waitForWebhook`** — pauses until something calls back.
- **`logic.loop`** — repeats the chain wired to its `"each"` handle once per item, then continues
  from `"done"`. Everything that should happen once, after the loop, goes on `"done"`.

Inside a loop body, `{{ $item }}` is the item being worked on.
