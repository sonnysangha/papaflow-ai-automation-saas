import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APP_ORIGIN_TOKEN,
  substituteAppOrigin,
  type ConnectorTestResult,
} from "@/connectors/define";
import {
  DISCORD_USER_PREFIX,
  discordBotConnector,
  discordInviteUrl,
  discordUserId,
  openDiscordDm,
} from "@/connectors/discord-bot";
import { discordWebhookConnector, parseDiscordWebhookUrl } from "@/connectors/discord-webhook";
import {
  SLACK_BOT_SCOPES,
  SLACK_EVENTS_PATH,
  SLACK_INTERACTIVITY_URL,
  slackAppManifest,
  slackConnector,
} from "@/connectors/slack";
import { telegramConnector } from "@/connectors/telegram";

/**
 * The three chat connectors, against a routing table like `tests/trigger-connectors.test.ts`: a
 * request to a URL the verified docs (docs/research/connectors-chat.md) do not list is a failure,
 * not a silent pass. Nothing here touches the network, and a token only ever appears inside an
 * asserted header.
 */

const SLACK_TOKEN = "xoxb-1111-2222-testtokenabcd";
const AUTH_TEST = "https://slack.com/api/auth.test";
const CHANNELS = "https://slack.com/api/conversations.list?types=public_channel%2Cprivate_channel&limit=1000";
const CHANNELS_PAGE_2 = `${CHANNELS}&cursor=page2`;
const USERS = "https://slack.com/api/users.list?limit=200";
const USERS_PAGE_2 = `${USERS}&cursor=people2`;

/** One page of people, with the three kinds of member that must never reach the dropdown. */
const USERS_BODY = {
  ok: true,
  members: [
    { id: "U1", name: "sonny", real_name: "Sonny Sangha" },
    { id: "U2", name: "ada", profile: { real_name: "Ada Lovelace" } },
    // Same handle as name: no redundant `(@…)` suffix.
    { id: "U3", name: "grace" },
    { id: "UBOT", name: "papaflow", is_bot: true },
    { id: "UGONE", name: "ghost", real_name: "Left Long Ago", deleted: true },
    { id: "USLACKBOT", name: "slackbot", real_name: "Slackbot" },
  ],
  response_metadata: { next_cursor: "" },
};

/** What `USERS_BODY` should survive as. */
const SLACK_PEOPLE = [
  { id: "U1", label: "DM · Sonny Sangha (@sonny)" },
  { id: "U2", label: "DM · Ada Lovelace (@ada)" },
  { id: "U3", label: "DM · grace" },
];

const BOT_TOKEN = "MTIzNDU2Nzg5.Gabcde.bot-token-wxyz";
const APP_ID = "1234567890123456789";
const USERS_ME = "https://discord.com/api/v10/users/@me";
const GUILDS = "https://discord.com/api/v10/users/@me/guilds";
const GUILD_CHANNELS = "https://discord.com/api/v10/guilds/555/channels";
const OTHER_GUILD_CHANNELS = "https://discord.com/api/v10/guilds/666/channels";
const GUILD_MEMBERS = "https://discord.com/api/v10/guilds/555/members?limit=200";
const OTHER_GUILD_MEMBERS = "https://discord.com/api/v10/guilds/666/members?limit=200";
const CREATE_DM = "https://discord.com/api/v10/users/@me/channels";

const WEBHOOK_ID = "987654321098765432";
const WEBHOOK_TOKEN = "aBcDeF-webhook-token_1234";
const WEBHOOK_URL = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;

type Route = { status?: number; body?: unknown } | { throws: true };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function stubFetch(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: { ...(init.headers as Record<string, string> | undefined) },
        body: typeof init.body === "string" ? init.body : undefined,
      });
      const route = routes[url];
      if (!route) throw new Error(`unstubbed request: ${url}`);
      if ("throws" in route) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(route.body ?? {}), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

/** No connector may reach the network unless a test said it could. */
function forbidFetch(): Call[] {
  return stubFetch({});
}

function expectOk(result: ConnectorTestResult) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

function expectFailed(result: ConnectorTestResult) {
  if (result.ok) throw new Error(`expected failure, got: ${result.label}`);
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slack connector", () => {
  it("is a Pro chat bot-token connector with an optional signing secret", () => {
    expect(slackConnector).toMatchObject({
      provider: "slack",
      name: "Slack",
      category: "chat",
      kind: "botToken",
      requiresFeature: "pro_connectors",
    });
    expect(slackConnector.fields.map((field) => field.name)).toEqual(["botToken", "signingSecret"]);
    expect(slackConnector.fields[0]).toMatchObject({ kind: "secret", placeholder: "xoxb-…" });
    expect(slackConnector.fields[1]).toMatchObject({
      kind: "secret",
      required: false,
      help: "Only needed for Approval buttons and Slack triggers",
    });
    expect(slackConnector.docsUrl).toMatch(/^https:\/\//);
  });

  it("validates a bot token with auth.test and captures the workspace", async () => {
    const calls = stubFetch({
      [AUTH_TEST]: {
        body: { ok: true, team: "PapaFam", team_id: "T0001", user_id: "U0BOT", bot_id: "B0001" },
      },
    });

    const result = expectOk(await slackConnector.test({ botToken: SLACK_TOKEN }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: AUTH_TEST, method: "POST" });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SLACK_TOKEN}`);
    expect(result.label).toBe("PapaFam");
    expect(result.hint).toBe(SLACK_TOKEN.slice(-4));
    expect(result.meta).toEqual({ team_id: "T0001", team_name: "PapaFam", bot_user_id: "U0BOT" });
  });

  it("reads Slack's refusal out of a 200 body", async () => {
    stubFetch({ [AUTH_TEST]: { body: { ok: false, error: "invalid_auth" } } });
    expect(expectFailed(await slackConnector.test({ botToken: SLACK_TOKEN })).error).toMatch(
      /rejected that bot token/i,
    );

    vi.unstubAllGlobals();
    stubFetch({ [AUTH_TEST]: { body: { ok: false, error: "account_inactive" } } });
    expect(expectFailed(await slackConnector.test({ botToken: SLACK_TOKEN })).error).toMatch(
      /account_inactive/,
    );

    vi.unstubAllGlobals();
    stubFetch({ [AUTH_TEST]: { throws: true } });
    expect(expectFailed(await slackConnector.test({ botToken: SLACK_TOKEN })).error).toMatch(
      /Could not reach Slack/,
    );
  });

  it("refuses a blank token without calling Slack", async () => {
    const calls = forbidFetch();
    expectFailed(await slackConnector.test({ botToken: "  " }));
    expect(calls).toHaveLength(0);
  });

  it("refuses a 200 that names no workspace", async () => {
    stubFetch({ [AUTH_TEST]: { body: { ok: true, team: "PapaFam" } } });
    expect(expectFailed(await slackConnector.test({ botToken: SLACK_TOKEN })).error).toMatch(
      /workspace/i,
    );
  });

  it("pages through conversations.list and labels channels with a hash", async () => {
    const calls = stubFetch({
      [CHANNELS]: {
        body: {
          ok: true,
          channels: [
            { id: "C1", name: "general" },
            { id: "C2", name: "random" },
          ],
          response_metadata: { next_cursor: "page2" },
        },
      },
      [CHANNELS_PAGE_2]: {
        body: {
          ok: true,
          channels: [{ id: "C3", name: "private-ops" }],
          response_metadata: { next_cursor: "" },
        },
      },
      [USERS]: { body: { ok: true, members: [], response_metadata: { next_cursor: "" } } },
    });

    const options = await slackConnector.pick?.("channels", { botToken: SLACK_TOKEN }, {});

    expect(calls.map((call) => call.url)).toEqual([CHANNELS, CHANNELS_PAGE_2, USERS]);
    expect(calls.every((call) => call.headers.Authorization === `Bearer ${SLACK_TOKEN}`)).toBe(true);
    expect(options).toEqual([
      { id: "C1", label: "#general" },
      { id: "C2", label: "#random" },
      { id: "C3", label: "#private-ops" },
    ]);
  });

  /**
   * DMs. `chat.postMessage` takes a user id in the same `channel` argument it takes a channel id in
   * and opens the conversation itself (docs.slack.dev/reference/methods/chat.postMessage), so a
   * person is an option like any other — the only work is listing them and keeping the list to
   * people.
   */
  it("appends people to the same list, as DM options carrying their user id", async () => {
    const calls = stubFetch({
      [CHANNELS]: {
        body: { ok: true, channels: [{ id: "C1", name: "general" }], response_metadata: {} },
      },
      [USERS]: { body: USERS_BODY },
    });

    const options = await slackConnector.pick?.("targets", { botToken: SLACK_TOKEN }, {});

    expect(calls.map((call) => call.url)).toEqual([CHANNELS, USERS]);
    // Channels first — what a workflow usually means — then everyone who can be DMed.
    expect(options).toEqual([{ id: "C1", label: "#general" }, ...SLACK_PEOPLE]);
    // Bots, deactivated accounts and Slackbot are members of `users.list` and none of them is
    // somebody a workflow means to message.
    expect(options?.map((option) => option.id)).not.toContain("UBOT");
    expect(options?.map((option) => option.id)).not.toContain("UGONE");
    expect(options?.map((option) => option.id)).not.toContain("USLACKBOT");
  });

  it("pages the people list with a cursor, like the channel list", async () => {
    const calls = stubFetch({
      [CHANNELS]: { body: { ok: true, channels: [], response_metadata: {} } },
      [USERS]: {
        body: {
          ok: true,
          members: [{ id: "U1", name: "sonny", real_name: "Sonny Sangha" }],
          response_metadata: { next_cursor: "people2" },
        },
      },
      [USERS_PAGE_2]: {
        body: {
          ok: true,
          members: [{ id: "U9", name: "late", real_name: "Late Joiner" }],
          response_metadata: { next_cursor: "" },
        },
      },
    });

    await expect(slackConnector.pick?.("channels", { botToken: SLACK_TOKEN }, {})).resolves.toEqual([
      { id: "U1", label: "DM · Sonny Sangha (@sonny)" },
      { id: "U9", label: "DM · Late Joiner (@late)" },
    ]);
    expect(calls.map((call) => call.url)).toEqual([CHANNELS, USERS, USERS_PAGE_2]);
  });

  /**
   * The compatibility case, and the reason `slackPeople` swallows its own failure: an app installed
   * before `users:read` was in the manifest answers `missing_scope`, and losing the channel list
   * over a feature that workspace has never had would be a regression for every existing user.
   */
  it("keeps the channel list when the token predates users:read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch({
      [CHANNELS]: {
        body: { ok: true, channels: [{ id: "C1", name: "general" }], response_metadata: {} },
      },
      [USERS]: { body: { ok: false, error: "missing_scope" } },
    });

    await expect(slackConnector.pick?.("targets", { botToken: SLACK_TOKEN }, {})).resolves.toEqual([
      { id: "C1", label: "#general" },
    ]);
  });

  it("throws when Slack refuses the channel list, and ignores an unknown picker", async () => {
    stubFetch({ [CHANNELS]: { body: { ok: false, error: "missing_scope" } } });
    await expect(slackConnector.pick?.("channels", { botToken: SLACK_TOKEN }, {})).rejects.toThrow(
      /missing_scope/,
    );

    vi.unstubAllGlobals();
    const calls = forbidFetch();
    await expect(slackConnector.pick?.("guilds", { botToken: SLACK_TOKEN }, {})).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("says what fills an empty list, in Slack's terms", () => {
    for (const kind of ["channels", "targets"]) {
      expect(slackConnector.emptyHint?.(kind)).toMatch(/Invite the bot to a channel/);
      expect(slackConnector.emptyHint?.(kind)).toMatch(/person to DM/);
    }
    expect(slackConnector.emptyHint?.("models")).toBeNull();
  });
});

describe("discord webhook connector", () => {
  it("is a free chat webhook-url connector with one field and no picker", () => {
    expect(discordWebhookConnector).toMatchObject({
      provider: "discord-webhook",
      name: "Discord Webhook",
      category: "chat",
      kind: "webhookUrl",
      requiresFeature: null,
    });
    expect(discordWebhookConnector.fields).toHaveLength(1);
    expect(discordWebhookConnector.fields[0]).toMatchObject({ name: "webhookUrl", kind: "url" });
    expect(discordWebhookConnector.pick).toBeUndefined();
  });

  it("parses the id and token out of every shape Discord hands out", () => {
    expect(parseDiscordWebhookUrl(WEBHOOK_URL)).toEqual({ id: WEBHOOK_ID, token: WEBHOOK_TOKEN });
    expect(parseDiscordWebhookUrl(`https://discordapp.com/api/v10/webhooks/1/tok_2`)).toEqual({
      id: "1",
      token: "tok_2",
    });
    expect(parseDiscordWebhookUrl("https://example.com/hooks/1/2")).toBeNull();
  });

  it("GETs the webhook itself and captures the channel it posts to", async () => {
    const calls = stubFetch({
      [WEBHOOK_URL]: {
        body: {
          id: WEBHOOK_ID,
          name: "papaflow",
          channel_id: "C900",
          guild_id: "G100",
          type: 1,
        },
      },
    });

    // Pasted in the older `discordapp.com/api/v10` form: the call is still the canonical URL.
    const result = expectOk(
      await discordWebhookConnector.test({
        webhookUrl: `https://discordapp.com/api/v10/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: WEBHOOK_URL, method: "GET" });
    expect(result.label).toBe("#papaflow");
    expect(result.hint).toBe(WEBHOOK_TOKEN.slice(-4));
    expect(result.meta).toEqual({
      channel_id: "C900",
      guild_id: "G100",
      name: "papaflow",
      webhook_id: WEBHOOK_ID,
    });
  });

  it("says so when the webhook is gone, and when the URL is not one", async () => {
    stubFetch({ [WEBHOOK_URL]: { status: 404, body: { message: "Unknown Webhook", code: 10015 } } });
    expect(expectFailed(await discordWebhookConnector.test({ webhookUrl: WEBHOOK_URL })).error).toMatch(
      /deleted/i,
    );

    vi.unstubAllGlobals();
    const calls = forbidFetch();
    expect(
      expectFailed(await discordWebhookConnector.test({ webhookUrl: "https://example.com/nope" })).error,
    ).toMatch(/does not look like/i);
    expectFailed(await discordWebhookConnector.test({ webhookUrl: "  " }));
    expect(calls).toHaveLength(0);
  });

  it("reports an unreachable Discord rather than throwing", async () => {
    stubFetch({ [WEBHOOK_URL]: { throws: true } });
    expect(expectFailed(await discordWebhookConnector.test({ webhookUrl: WEBHOOK_URL })).error).toMatch(
      /Could not reach Discord/,
    );
  });
});

describe("discord bot connector", () => {
  const SECRET = { botToken: BOT_TOKEN, applicationId: APP_ID, publicKey: "abc123" };

  it("is a free chat bot-token connector with three fields", () => {
    expect(discordBotConnector).toMatchObject({
      provider: "discord-bot",
      name: "Discord Bot",
      category: "chat",
      kind: "botToken",
      requiresFeature: null,
    });
    expect(discordBotConnector.fields.map((field) => field.name)).toEqual([
      "botToken",
      "applicationId",
      "publicKey",
    ]);
    expect(discordBotConnector.fields[0].kind).toBe("secret");
    expect(discordBotConnector.fields[1].kind).toBe("text");
    expect(discordBotConnector.fields[2].kind).toBe("text");
  });

  it("identifies the bot with a Bot token and builds the invite URL", async () => {
    const calls = stubFetch({ [USERS_ME]: { body: { id: "B77", username: "papaflow" } } });

    const result = expectOk(await discordBotConnector.test(SECRET));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: USERS_ME, method: "GET" });
    expect(calls[0].headers.Authorization).toBe(`Bot ${BOT_TOKEN}`);
    expect(result.label).toBe("papaflow");
    expect(result.hint).toBe(BOT_TOKEN.slice(-4));
    expect(result.meta).toEqual({
      bot_id: "B77",
      bot_username: "papaflow",
      applicationId: APP_ID,
      publicKey: "abc123",
      inviteUrl: `https://discord.com/oauth2/authorize?client_id=${APP_ID}&scope=bot%20applications.commands&permissions=3072`,
    });
    expect(discordInviteUrl(APP_ID)).toBe(result.meta.inviteUrl);
  });

  it("insists on both the token and the application id before calling Discord", async () => {
    const calls = forbidFetch();
    expectFailed(await discordBotConnector.test({ botToken: "", applicationId: APP_ID }));
    expect(expectFailed(await discordBotConnector.test({ botToken: BOT_TOKEN })).error).toMatch(
      /application ID/i,
    );
    expect(calls).toHaveLength(0);
  });

  it("reports a rejected token and an unreachable Discord", async () => {
    stubFetch({ [USERS_ME]: { status: 401, body: { message: "401: Unauthorized", code: 0 } } });
    expect(expectFailed(await discordBotConnector.test(SECRET)).error).toMatch(/rejected that bot token/i);

    vi.unstubAllGlobals();
    stubFetch({ [USERS_ME]: { throws: true } });
    expect(expectFailed(await discordBotConnector.test(SECRET)).error).toMatch(/Could not reach Discord/);
  });

  it("lists guilds", async () => {
    const calls = stubFetch({
      [GUILDS]: { body: [{ id: "555", name: "PapaFam" }, { id: "666", name: "Side project" }] },
    });

    await expect(discordBotConnector.pick?.("guilds", SECRET, {})).resolves.toEqual([
      { id: "555", label: "PapaFam" },
      { id: "666", label: "Side project" },
    ]);
    expect(calls[0].headers.Authorization).toBe(`Bot ${BOT_TOKEN}`);
  });

  it("lists only text channels for one guild", async () => {
    const calls = stubFetch({
      [GUILD_CHANNELS]: {
        body: [
          { id: "C1", name: "general", type: 0 },
          { id: "C2", name: "Voice", type: 2 },
          { id: "C3", name: "announcements", type: 5 },
          { id: "C4", name: "ops", type: 0 },
        ],
      },
    });

    await expect(discordBotConnector.pick?.("channels:555", SECRET, {})).resolves.toEqual([
      { id: "C1", label: "#general" },
      { id: "C4", label: "#ops" },
    ]);
    expect(calls.map((call) => call.url)).toEqual([GUILD_CHANNELS]);
  });

  it("walks every guild for an unscoped channel list and names the server", async () => {
    const calls = stubFetch({
      [GUILDS]: { body: [{ id: "555", name: "PapaFam" }, { id: "666", name: "Side project" }] },
      [GUILD_CHANNELS]: { body: [{ id: "C1", name: "general", type: 0 }] },
      [OTHER_GUILD_CHANNELS]: { body: [{ id: "C9", name: "general", type: 0 }] },
      // The members endpoint needs the privileged Server Members Intent; without it every guild
      // answers 403 and the list is channels only, exactly as it was before DMs existed.
      [GUILD_MEMBERS]: { status: 403, body: { message: "Missing Access", code: 50001 } },
      [OTHER_GUILD_MEMBERS]: { status: 403, body: { message: "Missing Access", code: 50001 } },
    });

    await expect(discordBotConnector.pick?.("channels", SECRET, {})).resolves.toEqual([
      { id: "C1", label: "#general · PapaFam" },
      { id: "C9", label: "#general · Side project" },
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      GUILDS,
      GUILD_CHANNELS,
      GUILD_MEMBERS,
      OTHER_GUILD_CHANNELS,
      OTHER_GUILD_MEMBERS,
    ]);
  });

  /**
   * DMs, for a bot whose app has the Server Members Intent switched on — the only way to enumerate
   * members at all (docs.discord.com/developers/resources/guild). The value carries a `user:`
   * prefix because a Discord snowflake says nothing about whether it is a channel or a person, and
   * guessing wrong means posting a private approval into a channel.
   */
  it("offers the people it can see as user: targets, once per person", async () => {
    stubFetch({
      [GUILDS]: { body: [{ id: "555", name: "PapaFam" }, { id: "666", name: "Side project" }] },
      [GUILD_CHANNELS]: { body: [{ id: "C1", name: "general", type: 0 }] },
      [OTHER_GUILD_CHANNELS]: { body: [] },
      [GUILD_MEMBERS]: {
        body: [
          { nick: "Sonny", user: { id: "U1", username: "sonny", global_name: "Sonny Sangha" } },
          { user: { id: "U2", username: "ada", global_name: "Ada Lovelace" } },
          { user: { id: "U3", username: "grace" } },
          { user: { id: "UBOT", username: "some-bot", bot: true } },
        ],
      },
      // The same person again, in the bot's other server: one option, not two.
      [OTHER_GUILD_MEMBERS]: { body: [{ user: { id: "U1", username: "sonny" } }] },
    });

    await expect(discordBotConnector.pick?.("targets", SECRET, {})).resolves.toEqual([
      { id: "C1", label: "#general · PapaFam" },
      { id: "user:U1", label: "DM · Sonny (@sonny)" },
      { id: "user:U2", label: "DM · Ada Lovelace (@ada)" },
      { id: "user:U3", label: "DM · grace" },
    ]);
  });

  it("opens a DM channel with POST /users/@me/channels", async () => {
    const calls = stubFetch({ [CREATE_DM]: { body: { id: "DM123", type: 1 } } });

    await expect(openDiscordDm(BOT_TOKEN, "U1")).resolves.toEqual({ ok: true, channelId: "DM123" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: CREATE_DM, method: "POST" });
    expect(calls[0].headers.Authorization).toBe(`Bot ${BOT_TOKEN}`);
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ recipient_id: "U1" });
  });

  it("reports a DM Discord would not open, rather than throwing", async () => {
    stubFetch({
      [CREATE_DM]: { status: 403, body: { message: "Cannot send messages to this user", code: 50007 } },
    });

    await expect(openDiscordDm(BOT_TOKEN, "U1")).resolves.toMatchObject({
      ok: false,
      status: 403,
    });

    vi.unstubAllGlobals();
    stubFetch({ [CREATE_DM]: { body: {} } });
    await expect(openDiscordDm(BOT_TOKEN, "U1")).resolves.toMatchObject({ ok: false, status: 502 });
  });

  it("reads the user id out of a user: target and nothing else", () => {
    expect(DISCORD_USER_PREFIX).toBe("user:");
    expect(discordUserId("user:123456789")).toBe("123456789");
    expect(discordUserId("user: 123 ")).toBe("123");
    expect(discordUserId("user:")).toBeNull();
    // A bare snowflake is a channel; treating it as a user would DM whoever owns that id.
    expect(discordUserId("123456789")).toBeNull();
  });

  it("throws when Discord refuses a list, and ignores an unknown picker", async () => {
    stubFetch({ [GUILDS]: { status: 403, body: { message: "Missing Access", code: 50001 } } });
    await expect(discordBotConnector.pick?.("guilds", SECRET, {})).rejects.toThrow(/Missing Access/);

    vi.unstubAllGlobals();
    const calls = forbidFetch();
    await expect(discordBotConnector.pick?.("models", SECRET, {})).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("says what fills an empty list, and how to DM without the members intent", () => {
    for (const kind of ["channels", "targets"]) {
      expect(discordBotConnector.emptyHint?.(kind)).toMatch(/Invite the bot to the server/);
      expect(discordBotConnector.emptyHint?.(kind)).toMatch(/user:<their Discord id>/);
    }
    expect(discordBotConnector.emptyHint?.("guilds")).toBeNull();
  });
});

describe("telegram pick, alongside the other chat connectors", () => {
  it("answers `chats` from meta without a request, and ignores every other kind", async () => {
    const calls = forbidFetch();
    const meta = {
      chat_ids: [
        { id: 42, title: "Ops room", type: "supergroup" },
        // Learned before the route recorded a `type`: named the way only a private chat is.
        { id: 7, first_name: "Sonny" },
        { id: 9 },
      ],
    };

    await expect(telegramConnector.pick?.("chats", { botToken: "x" }, meta)).resolves.toEqual([
      { id: "7", label: "DM · Sonny" },
      { id: "42", label: "Ops room" },
      { id: "9", label: "9" },
    ]);
    await expect(telegramConnector.pick?.("channels", { botToken: "x" }, meta)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  /**
   * The user's actual complaint: an Approval node on a Telegram connection whose "Ask in" picker
   * was empty. A DM is the one chat a bot can *never* be invited into — the person has to write
   * first (core.telegram.org/bots/api) — so the fix is half labelling and half saying so.
   */
  it("labels a private chat as a DM, with the name and handle, and lists DMs first", async () => {
    const meta = {
      chat_ids: [
        { id: -1001234567890, title: "PapaFam", type: "supergroup" },
        { id: 111, type: "private", first_name: "Sonny", last_name: "Sangha", username: "sonny" },
        { id: 222, type: "private", first_name: "Ada" },
        { id: 333, type: "private", username: "grace" },
        { id: -100999, title: "Announcements", type: "channel" },
      ],
    };

    for (const kind of ["chats", "targets"]) {
      await expect(telegramConnector.pick?.(kind, { botToken: "x" }, meta)).resolves.toEqual([
        { id: "111", label: "DM · Sonny Sangha (@sonny)" },
        { id: "222", label: "DM · Ada" },
        { id: "333", label: "DM · @grace" },
        { id: "-1001234567890", label: "PapaFam" },
        { id: "-100999", label: "Announcements" },
      ]);
    }
  });

  it("tells a Telegram user to message the bot, not to invite it", () => {
    const hint =
      "No chats yet. Open Telegram, send the bot any message (or /start) from the account or " +
      "group you want it to post in, then reload.";
    expect(telegramConnector.emptyHint?.("chats")).toBe(hint);
    expect(telegramConnector.emptyHint?.("targets")).toBe(hint);
    // The generic sentence is the wrong advice here, and this is the whole reason `emptyHint` exists.
    expect(telegramConnector.emptyHint?.("targets")).not.toMatch(/invite/i);
    expect(telegramConnector.emptyHint?.("models")).toBeNull();
  });
});

/**
 * The Slack app manifest, which is the one connector artefact a user has to paste *into* the
 * provider before they have anything to paste back. Its scopes are load-bearing: a manifest missing
 * `groups:read` produces a channel picker that works for every workspace without private channels
 * and fails for the rest, which is the kind of bug that only shows up on someone else's laptop.
 */
describe("slack app manifest", () => {
  type Manifest = {
    display_information: { name: string; description?: string };
    features: { bot_user: { display_name: string; always_online: boolean } };
    oauth_config: { scopes: { bot: string[] } };
    settings: {
      interactivity: { is_enabled: boolean; request_url: string };
      token_rotation_enabled: boolean;
    };
  };

  const manifest = () => slackAppManifest() as unknown as Manifest;

  it("asks for exactly the scopes chat.postMessage, conversations.list and users.list need", () => {
    // `chat:write` posts, `chat:write.public` posts without an invite, and the channel picker asks
    // for `types=public_channel,private_channel` — one read scope each. `users:read` is the DM
    // half: it is what `users.list` needs to name the people in the dropdown.
    expect(SLACK_BOT_SCOPES).toEqual([
      "chat:write",
      "chat:write.public",
      "channels:read",
      "groups:read",
      "users:read",
    ]);
    expect(manifest().oauth_config.scopes.bot).toEqual([...SLACK_BOT_SCOPES]);

    // Posting the DM itself needs nothing beyond `chat:write`: passing a user id as `channel` opens
    // the conversation (docs.slack.dev/reference/methods/chat.postMessage). Asking for `im:write`
    // or `im:read` would be a scope users have to approve for a call this app never makes.
    expect(SLACK_BOT_SCOPES).not.toContain("im:write");
    expect(SLACK_BOT_SCOPES).not.toContain("im:read");
    expect(SLACK_BOT_SCOPES).not.toContain("mpim:read");
  });

  it("tells the user that DMs work without an invite", () => {
    expect(slackConnector.setup?.steps.join(" ")).toMatch(/users:read/);
    expect(slackConnector.setup?.steps.join(" ")).toMatch(/DM · Name/);
  });

  it("switches interactivity on and points it at this deployment's own Slack endpoint", () => {
    const { interactivity } = manifest().settings;
    expect(interactivity.is_enabled).toBe(true);

    // The URL a user pastes into Slack has to be the real one, and it can be: `/api/events/slack`
    // needs no connection id, because a delivery names its own workspace. Only the origin is
    // unknowable here — the catalogue is built without a request — so it is a token the connections
    // UI swaps out (`components/connections/ConnectorSetup.tsx`).
    expect(interactivity.request_url).toBe(SLACK_INTERACTIVITY_URL);
    expect(interactivity.request_url).toBe(`${APP_ORIGIN_TOKEN}${SLACK_EVENTS_PATH}`);
    expect(interactivity.request_url).toBe("{{APP_ORIGIN}}/api/events/slack");
    // Not a connection id in sight: this URL is the same for every organisation.
    expect(interactivity.request_url).not.toMatch(/CONNECTION_ID/);

    // Substituted, it is the `https` URL Slack demands — and nothing but the origin changed.
    const substituted = substituteAppOrigin(
      interactivity.request_url,
      "https://papaflow.vercel.app",
    );
    expect(substituted).toBe("https://papaflow.vercel.app/api/events/slack");
    expect(new URL(substituted).protocol).toBe("https:");
  });

  it("never enables token rotation, which cannot be turned off again", () => {
    expect(manifest().settings.token_rotation_enabled).toBe(false);
  });

  it("names the app and derives a bot display name Slack will accept", () => {
    expect(manifest().display_information.name).toBe("PapaFlow");
    expect(manifest().features.bot_user.display_name).toBe("PapaFlow");

    // `display_name` allows only letters, digits, `-`, `_` and `.`; a name with spaces is common.
    const custom = slackAppManifest("Acme Ops Bot") as unknown as Manifest;
    expect(custom.display_information.name).toBe("Acme Ops Bot");
    expect(custom.features.bot_user.display_name).toBe("Acme-Ops-Bot");

    // Slack's own limits: 35 characters for the app name, 140 for the description.
    const long = slackAppManifest("x".repeat(80)) as unknown as Manifest;
    expect(long.display_information.name).toHaveLength(35);
    expect(long.display_information.description?.length).toBeLessThanOrEqual(140);

    // A blank name is a mistake, not a request for a nameless app.
    expect((slackAppManifest("   ") as unknown as Manifest).display_information.name).toBe("PapaFlow");
  });

  it("is plain JSON, and a fresh object every call", () => {
    const first = slackAppManifest();
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);

    (first.display_information as { name: string }).name = "tampered";
    expect(manifest().display_information.name).toBe("PapaFlow");
  });

  it("reaches the UI through the connector's own setup block", () => {
    const setup = slackConnector.setup;
    expect(setup?.title).toBeTruthy();
    expect(setup?.manifest).toEqual(slackAppManifest());
    // Six steps, each a sentence somebody can follow without knowing what a manifest is.
    expect(setup?.steps.length).toBeGreaterThanOrEqual(4);
    expect(setup?.steps.every((step) => step.trim().length > 0)).toBe(true);
    expect(setup?.steps.join(" ")).toMatch(/Signing Secret/);
    expect(setup?.steps.join(" ")).toMatch(/Interactivity/);
    // The step about interactivity quotes the same URL the manifest sets, token and all, so the
    // substitution the UI does covers the instructions too.
    expect(setup?.steps.join(" ")).toContain(SLACK_INTERACTIVITY_URL);
    // Nobody is sent back to paste a per-connection URL any more.
    expect(setup?.steps.join(" ")).not.toMatch(/connection's own id/);
  });

  it("names the workspace key inbound deliveries are matched by", () => {
    // `test()` reports `meta.team_id`; `externalIdFrom` is what lifts it into the indexed column
    // that `POST /api/events/slack` looks a delivery's `team.id` up in.
    expect(slackConnector.externalIdFrom).toBe("team_id");
    expect(discordBotConnector.externalIdFrom).toBeUndefined();
    expect(telegramConnector.externalIdFrom).toBeUndefined();
  });

  it("is the only connector that needs a provider-side app", () => {
    // Every other credential is pasted from something that already exists.
    expect(discordBotConnector.setup).toBeUndefined();
    expect(telegramConnector.setup).toBeUndefined();
    expect(discordWebhookConnector.setup).toBeUndefined();
  });
});
