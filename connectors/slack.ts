// A Slack bot token (`xoxb-…`) is pasted rather than OAuthed: Slack's redirect URLs are HTTPS-only
// with no localhost exception (docs/research/connectors-chat.md), so "Install to workspace" and copy
// the token is the one route that works from a laptop. Phase 7 adds the OAuth flow beside this.
//
// `auth.test` both validates the token and tells us which workspace it belongs to, which is the
// label users recognise. The signing secret is optional and unused here — it only matters once
// Slack posts *to* us (Approval buttons in Phase 8, the mention trigger in Phase 7), and asking for
// it now saves a second trip to the app's settings page.
import { APP_ORIGIN_TOKEN, defineConnector, TARGETS_PICKER } from "./define";

/**
 * Every bot scope this app's Slack calls need, and nothing else.
 *
 * `chat:write` posts (`nodes/actions/slack-post.ts` and the Approval node's `chat.postMessage`);
 * `chat:write.public` is what lets it post to a public channel nobody has invited it to — Slack
 * documents that it "must also request chat:write". The two channel read scopes are the channel
 * picker: `conversations.list?types=public_channel,private_channel` needs `channels:read` for the
 * public half and `groups:read` for the private half, and a token missing the second answers
 * `missing_scope` for the whole call rather than a shorter list.
 *
 * `users:read` is the DM half, and it is a *listing* scope only: `chat.postMessage` opens the
 * conversation itself when `channel` is a user id — "provide the user's ID as the channel value and
 * a direct message conversation will be opened if it isn't open already"
 * (docs.slack.dev/reference/methods/chat.postMessage), which needs nothing beyond `chat:write`. So
 * no `im:write`, and no `im:read` either: the people in the picker come from `users.list`
 * (`users:read`) rather than from `conversations.list?types=im`, which would only ever list the DMs
 * the bot has already opened.
 *
 * Interactivity needs no scope at all: `POST /api/events/slack` is verified with the signing
 * secret, not with a token.
 */
export const SLACK_BOT_SCOPES: readonly string[] = [
  "chat:write",
  "chat:write.public",
  "channels:read",
  "groups:read",
  "users:read",
];

/** Slack's own limits on the two names in a manifest (docs.slack.dev/reference/app-manifest). */
const MAX_APP_NAME = 35;
const MAX_BOT_NAME = 80;

/** The app name the manifest carries unless the user asks for another. */
const DEFAULT_APP_NAME = "PapaFlow";

/**
 * Where Slack sends button presses and events, for every connection in every organisation.
 *
 * It used to be per connection (`/api/events/slack/:connectionId`, one signing secret per row),
 * which produced a manifest that could not name its own Request URL: the id it needs does not
 * exist until the app the manifest creates has produced a token to paste. The route now works the
 * other way round — it reads the workspace id Slack puts in every delivery (`team.id` on an
 * interactivity payload, `team_id` on an Events API envelope) and looks the connections up by it —
 * so the manifest can carry the real URL and nobody has to come back and paste one.
 *
 * The per-connection route still answers, for anyone who pasted one before this existed.
 */
export const SLACK_EVENTS_PATH = "/api/events/slack";

/**
 * That path as it goes into the manifest: `{{APP_ORIGIN}}` is swapped for this deployment's origin
 * when the connections UI renders it (`connectors/define.ts#substituteAppOrigin`), because the
 * catalogue is built once, in a module with no request and no `window`.
 *
 * Slack accepts only public `https` URLs here, so a laptop needs a tunnel — the setup section says
 * so whenever the origin it substituted is not one.
 */
export const SLACK_INTERACTIVITY_URL = `${APP_ORIGIN_TOKEN}${SLACK_EVENTS_PATH}`;

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
      description:
        "Runs your PapaFlow workflows: posts messages and asks for approvals, in channels or DMs.",
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
        request_url: SLACK_INTERACTIVITY_URL,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

const SLACK_API = "https://slack.com/api";
const TIMEOUT_MS = 15_000;

/**
 * Both kinds the bot can be a *member* of. `im` and `mpim` are deliberately not here: that list is
 * the DMs the bot has already opened, which is empty on a fresh app and is not the question the
 * picker is asking. People come from `users.list` instead, and `chat.postMessage` opens the DM.
 */
const CHANNEL_TYPES = "public_channel,private_channel";
/** Slack's own maximum for `conversations.list`; fewer pages means fewer round trips. */
const PAGE_SIZE = 1000;
/** 10 pages = 10,000 channels. Past that the dropdown is the wrong UI anyway. */
const MAX_PAGES = 10;
/** `users.list` recommends "no more than 200 results at a time" and refuses a `limit` over 1000. */
const USER_PAGE_SIZE = 200;
/** 5 pages = 1,000 people. A workspace bigger than that is a search box, not a dropdown. */
const MAX_USER_PAGES = 5;
/** Slack's own assistant is a member of every workspace and is nobody a workflow means to DM. */
const SLACKBOT_ID = "USLACKBOT";

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

/** …and one page of the people list. */
function usersUrl(cursor: string): string {
  const query = new URLSearchParams({ limit: String(USER_PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  return `${SLACK_API}/users.list?${query.toString()}`;
}

/** One `users.list` member, reduced to what deciding and labelling need. */
type Member = {
  id?: unknown;
  name?: unknown;
  real_name?: unknown;
  deleted?: unknown;
  is_bot?: unknown;
  profile?: { real_name?: unknown; display_name?: unknown };
};

function membersOf(payload: SlackResponse): Member[] {
  const members = payload.members;
  if (!Array.isArray(members)) return [];
  return members.filter((entry): entry is Member => typeof entry === "object" && entry !== null);
}

/**
 * Whether this member is a person somebody would mean to DM.
 *
 * Every workspace's `users.list` is mostly not people: deactivated accounts stay in it forever, and
 * every app that has ever been installed is a member with `is_bot`. Slackbot is neither of those and
 * still cannot be DMed usefully, so it goes by id.
 */
function isRealPerson(member: Member): boolean {
  if (member.deleted === true || member.is_bot === true) return false;
  return asString(member.id) !== SLACKBOT_ID;
}

/** `DM · Sonny Sangha (@sonny)` — the real name people recognise, with the handle that is unique. */
function memberLabel(member: Member): string {
  const handle = asString(member.name);
  const named =
    asString(member.real_name) ||
    asString(member.profile?.real_name) ||
    asString(member.profile?.display_name) ||
    handle ||
    asString(member.id);
  return handle && handle !== named ? `DM · ${named} (@${handle})` : `DM · ${named}`;
}

/** Every channel the bot is a member of (plus every public one, which it can post to uninvited). */
async function slackChannels(token: string): Promise<{ id: string; label: string }[]> {
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
}

/**
 * The people in the workspace, as options whose value is a user id — which is all a DM needs, since
 * `chat.postMessage` opens the conversation when `channel` is one.
 *
 * A refusal here is *not* fatal, which is the one thing worth knowing about this function: an app
 * installed before `users:read` was in the manifest answers `missing_scope`, and turning that into
 * a failed picker would take away the channel list too — for a feature that workspace has never
 * had. So the people half is dropped and the channels still arrive; reinstalling the app with the
 * current manifest is what brings the DMs back.
 */
async function slackPeople(token: string): Promise<{ id: string; label: string }[]> {
  const options: { id: string; label: string }[] = [];
  let cursor = "";

  for (let page = 0; page < MAX_USER_PAGES; page += 1) {
    const result = await callSlack(token, usersUrl(cursor));
    if (!result.ok) {
      console.warn(`slack: users.list — ${result.error} (DMs are not offered for this token)`);
      return [];
    }

    for (const member of membersOf(result.result)) {
      const id = asString(member.id);
      if (id && isRealPerson(member)) options.push({ id, label: memberLabel(member) });
    }

    cursor = nextCursor(result.result);
    if (!cursor) break;
  }

  return options;
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
      `The manifest already switches Interactivity on and points it at ${SLACK_INTERACTIVITY_URL}, so there is nothing to paste back: presses are matched to this connection by your workspace id.`,
      "Invite the bot to any private channel you want to post in (/invite @PapaFlow). Public channels work without an invite.",
      "Direct messages need no invite at all: the manifest asks for users:read, so the channel dropdown also lists everyone in the workspace as “DM · Name”, and Slack opens the conversation the first time your workflow posts.",
    ],
    manifest: slackAppManifest(),
  },

  /**
   * `test()` reports the workspace as `meta.team_id`; this promotes it to the indexed
   * `connections.externalId` column, which is how `POST /api/events/slack` — one URL for every
   * organisation — finds this row from the `team.id` inside a button press.
   */
  externalIdFrom: "team_id",

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
   * The "where should this go" dropdown behind `slack.postMessage` and the Approval node: every
   * channel the bot can post in, then every person it can DM.
   *
   * Channels come first because they are what a workflow usually means, and both halves write the
   * same kind of value — `chat.postMessage` takes a `C…` channel id or a `U…` user id in the same
   * `channel` argument, and opens the DM itself for the second. Private channels only appear once
   * the bot has been invited to them, which is exactly the set it can post to, so an empty channel
   * half is a real answer and not a failure.
   */
  async pick(kind, secret) {
    // `targets` is the provider-agnostic kind the Approval node asks for; for Slack that is the
    // same list `slack.postMessage` uses.
    if (kind !== "channels" && kind !== TARGETS_PICKER) return [];

    const token = secret.botToken?.trim() ?? "";
    return [...(await slackChannels(token)), ...(await slackPeople(token))];
  },

  /** Both halves of the list are empty, so say what fills each one. */
  emptyHint(kind) {
    if (kind !== "channels" && kind !== TARGETS_PICKER) return null;
    return (
      "No channels or people yet. Invite the bot to a channel (/invite @PapaFlow), or pick a " +
      "person to DM — reinstall the app from the manifest if people are missing, then reload."
    );
  },
});
