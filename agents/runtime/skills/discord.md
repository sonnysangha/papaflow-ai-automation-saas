---
description: Use when the goal is to post a message or an embed to Discord.
---

# Posting to Discord

`discord_post` writes through whichever kind of Discord connection the workspace added.

- A **webhook** connection always posts to the one channel it was created for. Leave `channelId`
  empty; setting it changes nothing.
- A **bot** connection can post anywhere it can see, so it needs `channelId`. Without one the call is
  refused.

Fill `content`, or at least one of `embedTitle` / `embedDescription` / `embedUrl` — an empty message
is rejected. An embed is for something with a title and a link; ordinary news goes in `content`.
