// A Slack bot token (`xoxb-…`) is pasted rather than OAuthed: Slack's redirect URLs are HTTPS-only
// with no localhost exception (docs/research/connectors-chat.md), so "Install to workspace" and copy
// the token is the one route that works from a laptop. Phase 7 adds the OAuth flow beside this.
//
// `auth.test` both validates the token and tells us which workspace it belongs to, which is the
// label users recognise. The signing secret is optional and unused here — it only matters once
// Slack posts *to* us (Approval buttons in Phase 8, the mention trigger in Phase 7), and asking for
// it now saves a second trip to the app's settings page.
import { defineConnector, TARGETS_PICKER } from "./define";

const SLACK_API = "https://slack.com/api";
const TIMEOUT_MS = 15_000;

/** Both kinds the bot can be a member of. DMs and group DMs are not channels a workflow posts to. */
const CHANNEL_TYPES = "public_channel,private_channel";
/** Slack's own maximum for `conversations.list`; fewer pages means fewer round trips. */
const PAGE_SIZE = 1000;
/** 10 pages = 10,000 channels. Past that the dropdown is the wrong UI anyway. */
const MAX_PAGES = 10;

type SlackResponse = { ok?: boolean; error?: string; [key: string]: unknown };

/**
 * Every Web API method answers `200 { ok: false, error: "invalid_auth" }` rather than a 4xx, so the
 * status line is only interesting for 429. The token travels in the header and never in a URL, so
 * nothing here can leak it into a log line.
 */
async function callSlack(
  token: string,
  url: string,
  body?: unknown,
): Promise<{ ok: true; result: SlackResponse } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not reach Slack. Check your connection and try again." };
  }

  const payload = (await response.json().catch(() => ({}))) as SlackResponse;
  if (payload.ok !== true) {
    const described = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    return { ok: false, error: described };
  }

  return { ok: true, result: payload };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One page of `conversations.list`, reduced to what the picker shows. */
type Conversation = { id?: unknown; name?: unknown };

function conversationsOf(payload: SlackResponse): Conversation[] {
  const channels = payload.channels;
  if (!Array.isArray(channels)) return [];
  return channels.filter((entry): entry is Conversation => typeof entry === "object" && entry !== null);
}

/** `response_metadata.next_cursor` is `""` — not absent — on the last page. */
function nextCursor(payload: SlackResponse): string {
  const metadata = payload.response_metadata;
  if (typeof metadata !== "object" || metadata === null) return "";
  return asString((metadata as { next_cursor?: unknown }).next_cursor);
}

/** The URL one page of the channel list is read from. Exported shape is the connector's, not this. */
function conversationsUrl(cursor: string): string {
  const query = new URLSearchParams({ types: CHANNEL_TYPES, limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  return `${SLACK_API}/conversations.list?${query.toString()}`;
}

export const slackConnector = defineConnector({
  provider: "slack",
  name: "Slack",
  category: "chat",
  kind: "botToken",
  requiresFeature: null,
  fields: [
    {
      name: "botToken",
      label: "Bot user OAuth token",
      kind: "secret",
      placeholder: "xoxb-…",
      help: "Your app's OAuth & Permissions page, after installing it to the workspace",
    },
    {
      name: "signingSecret",
      label: "Signing secret",
      kind: "secret",
      required: false,
      placeholder: "Optional",
      help: "Only needed for Approval buttons and Slack triggers",
    },
  ],
  docsUrl: "https://api.slack.com/apps",
  icon: "Hash",

  /** `auth.test` is the cheapest call that proves the token and names the workspace. */
  async test(secret) {
    const token = secret.botToken?.trim();
    if (!token) return { ok: false, error: "Paste the bot user OAuth token (xoxb-…) from your Slack app." };

    const result = await callSlack(token, `${SLACK_API}/auth.test`, {});
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.error === "invalid_auth" || result.error === "not_authed"
            ? "Slack rejected that bot token."
            : `Slack refused the request: ${result.error}`,
      };
    }

    const team = asString(result.result.team);
    const teamId = asString(result.result.team_id);
    if (!teamId) return { ok: false, error: "Slack accepted the token but returned no workspace." };

    return {
      ok: true,
      label: team || teamId,
      hint: token.slice(-4),
      meta: {
        team_id: teamId,
        team_name: team,
        // `user_id` on `auth.test` is the *bot* user for a bot token — the one that posts.
        bot_user_id: asString(result.result.user_id),
      },
    };
  },

  /**
   * The channel dropdown behind `slack.postMessage`. Private channels only appear once the bot has
   * been invited to them, which is exactly the set it can post to, so an empty list is a real
   * answer and not a failure.
   */
  async pick(kind, secret) {
    // `targets` is the provider-agnostic kind the Approval node asks for; for Slack that is the
    // same channel list `slack.postMessage` uses.
    if (kind !== "channels" && kind !== TARGETS_PICKER) return [];

    const token = secret.botToken?.trim() ?? "";
    const options: { id: string; label: string }[] = [];
    let cursor = "";

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await callSlack(token, conversationsUrl(cursor));
      if (!result.ok) throw new Error(`slack: conversations.list — ${result.error}`);

      for (const channel of conversationsOf(result.result)) {
        const id = asString(channel.id);
        const name = asString(channel.name);
        if (id) options.push({ id, label: name ? `#${name}` : id });
      }

      cursor = nextCursor(result.result);
      if (!cursor) break;
    }

    return options;
  },
});
