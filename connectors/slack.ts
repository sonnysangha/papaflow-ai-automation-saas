// A Slack bot token (`xoxb-…`) is pasted rather than OAuthed: Slack's redirect URLs are HTTPS-only
// with no localhost exception (docs/research/connectors-chat.md), so "Install to workspace" and copy
// the token is the one route that works from a laptop. Phase 7 adds the OAuth flow beside this.
//
// `auth.test` both validates the token and tells us which workspace it belongs to, which is the
// label users recognise. The signing secret is optional and unused here — it only matters once
// Slack posts *to* us (Approval buttons in Phase 8, the mention trigger in Phase 7), and asking for
// it now saves a second trip to the app's settings page.
import { defineConnector, TARGETS_PICKER } from "./define";

/**
 * Every bot scope this app's Slack calls need, and nothing else.
 *
 * `chat:write` posts (`nodes/actions/slack-post.ts` and the Approval node's `chat.postMessage`);
 * `chat:write.public` is what lets it post to a public channel nobody has invited it to — Slack
 * documents that it "must also request chat:write". The two read scopes are the channel picker:
 * `conversations.list?types=public_channel,private_channel` needs `channels:read` for the public
 * half and `groups:read` for the private half, and a token missing the second answers
 * `missing_scope` for the whole call rather than a shorter list.
 *
 * Interactivity needs no scope at all: `POST /api/events/slack/:connectionId` is verified with the
 * signing secret, not with a token.
 */
export const SLACK_BOT_SCOPES: readonly string[] = [
  "chat:write",
  "chat:write.public",
  "channels:read",
  "groups:read",
];

/** Slack's own limits on the two names in a manifest (docs.slack.dev/reference/app-manifest). */
const MAX_APP_NAME = 35;
const MAX_BOT_NAME = 80;

/** The app name the manifest carries unless the user asks for another. */
const DEFAULT_APP_NAME = "PapaFlow";

/**
 * What `settings.interactivity.request_url` says until the connection exists.
 *
 * It cannot say anything truer: the real URL ends in the connection's own id
 * (`/api/events/slack/:connectionId`, one signing secret per connection), and there is no
 * connection until this manifest has produced a token to paste. So the manifest ships a valid
 * HTTPS URL — Slack refuses a malformed one, and `example.com` is reserved for exactly this
 * (RFC 2606) — and `setup.steps` tells the user to replace it with the URL their connection row
 * shows once it is saved.
 */
export const SLACK_INTERACTIVITY_PLACEHOLDER =
  "https://papaflow.example.com/api/events/slack/CONNECTION_ID";

/** `display_name` allows letters, digits, `-`, `_` and `.` — a space in an app name is not one. */
function botDisplayName(appName: string): string {
  const cleaned = appName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || DEFAULT_APP_NAME).slice(0, MAX_BOT_NAME);
}

/**
 * The Slack app manifest a user pastes into "Create New App → From a manifest".
 *
 * It exists because every field of a Slack app that this connector depends on is easy to get
 * wrong by hand and invisible when you do: a missing `groups:read` makes the channel picker fail
 * only for workspaces with private channels, and interactivity left off makes Approval buttons do
 * nothing at all. One paste sets all of them.
 *
 * Plain data, no secrets, no per-org values — it is generated once for the connector catalogue and
 * crosses to the browser with it. `token_rotation_enabled` is spelled out as `false` on purpose:
 * Slack cannot turn rotation back off once it is on, and a rotating token would expire twelve
 * hours after the user pasted it.
 */
export function slackAppManifest(appName: string = DEFAULT_APP_NAME): Record<string, unknown> {
  const name = (appName.trim() || DEFAULT_APP_NAME).slice(0, MAX_APP_NAME);

  return {
    display_information: {
      name,
      description: "Runs your PapaFlow workflows: posts messages and asks for approvals.",
    },
    features: {
      bot_user: { display_name: botDisplayName(name), always_online: true },
    },
    oauth_config: {
      scopes: { bot: [...SLACK_BOT_SCOPES] },
    },
    settings: {
      interactivity: {
        is_enabled: true,
        request_url: SLACK_INTERACTIVITY_PLACEHOLDER,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

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
  requiresFeature: "pro_connectors",
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

  /**
   * Slack is the one connector whose credential does not exist yet when the user arrives: there is
   * no token to paste until they have created an app with the right scopes. These are the steps
   * for that, with the manifest that makes them one paste instead of a dozen checkboxes.
   */
  setup: {
    title: "Create your Slack app from this manifest",
    steps: [
      "Open https://api.slack.com/apps and choose Create New App → From a manifest.",
      "Pick the workspace this app should belong to, paste the JSON below, then create the app.",
      "On Install App, install it to the workspace and copy the Bot User OAuth Token (xoxb-…) into the field above.",
      "On Basic Information, copy the Signing Secret into the optional field — Approval buttons and Slack triggers are verified with it.",
      "Save the connection, then copy the interactivity URL from its row on the Connections page into Interactivity & Shortcuts → Request URL, replacing the placeholder from the manifest. That URL contains the connection's own id, so it only exists once the connection does.",
      "Invite the bot to any private channel you want to post in (/invite @PapaFlow). Public channels work without an invite.",
    ],
    manifest: slackAppManifest(),
  },

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
