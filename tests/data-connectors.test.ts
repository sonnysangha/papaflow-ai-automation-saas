import { afterEach, describe, expect, it, vi } from "vitest";

import { airtableConnector } from "@/connectors/airtable";
import type { ConnectorTestResult } from "@/connectors/define";
import { githubConnector } from "@/connectors/github";
import { linearConnector } from "@/connectors/linear";
import { notionConnector } from "@/connectors/notion";
import { resendConnector } from "@/connectors/resend";
import { teamsConnector } from "@/connectors/teams";

/**
 * The six data/chat/email connectors of Phase 6 Task 2, exercised against a routing table like
 * `tests/trigger-connectors.test.ts`: a request to a URL the verified docs do not list is a
 * failure, not a silent pass. Nothing here touches the network, and no token appears anywhere but
 * inside an asserted header.
 *
 * The headers are half the point. Notion refuses a call without `Notion-Version`, GitHub without a
 * `User-Agent`, Resend without one too, and Linear 401s on a personal key sent as `Bearer` — so
 * each of those is asserted rather than assumed (docs/research/connectors-data.md).
 */

type Route = { status?: number; body?: unknown; text?: string } | { throws: true };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** A URL maps to one answer, or to a queue of answers for a service that is called twice. */
function stubFetch(routes: Record<string, Route | Route[]>): Call[] {
  const calls: Call[] = [];
  const queues = new Map<string, Route[]>(
    Object.entries(routes).map(([url, route]) => [url, Array.isArray(route) ? [...route] : [route]]),
  );

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

      const queue = queues.get(url);
      if (!queue || queue.length === 0) throw new Error(`unstubbed request: ${url}`);
      const route = queue.length === 1 ? queue[0] : queue.shift()!;
      if ("throws" in route) throw new TypeError("fetch failed");

      return new Response(route.text ?? JSON.stringify(route.body ?? {}), {
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

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(call.body ?? "{}") as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------------------------

const NOTION_KEY = "ntn_secret_0123456789abcdef";
const NOTION_ME = "https://api.notion.com/v1/users/me";
const NOTION_SEARCH = "https://api.notion.com/v1/search";

describe("notion connector", () => {
  it("is a Pro data connector with one secret field", () => {
    expect(notionConnector).toMatchObject({
      provider: "notion",
      name: "Notion",
      category: "data",
      kind: "apiKey",
      requiresFeature: "pro_connectors",
      icon: "FileText",
    });
    expect(notionConnector.fields).toHaveLength(1);
    expect(notionConnector.fields[0]).toMatchObject({ name: "apiKey", kind: "secret", placeholder: "ntn_…" });
    expect(notionConnector.docsUrl).toMatch(/^https:\/\//);
  });

  it("validates the token with users/me and sends the pinned Notion-Version", async () => {
    const calls = stubFetch({
      [NOTION_ME]: {
        body: { object: "user", id: "bot_1", name: "PapaFlow", bot: { workspace_name: "Acme" } },
      },
    });

    const result = expectOk(await notionConnector.test({ apiKey: NOTION_KEY }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: NOTION_ME, method: "GET" });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${NOTION_KEY}`);
    expect(calls[0].headers["Notion-Version"]).toBe("2026-03-11");

    expect(result.label).toBe("Notion (Acme)");
    expect(result.hint).toBe(NOTION_KEY.slice(-4));
    expect(result.meta).toEqual({ bot_id: "bot_1", workspace_name: "Acme" });
  });

  it("falls back to the bot's own name when the workspace is unnamed", async () => {
    stubFetch({ [NOTION_ME]: { body: { id: "bot_1", name: "PapaFlow" } } });

    const result = expectOk(await notionConnector.test({ apiKey: NOTION_KEY }));
    expect(result.label).toBe("Notion (PapaFlow)");
    expect(result.meta).toEqual({ bot_id: "bot_1" });
  });

  it("reports a rejected secret, a described refusal and an unreachable API", async () => {
    stubFetch({ [NOTION_ME]: { status: 401, body: { message: "API token is invalid." } } });
    expect(expectFailed(await notionConnector.test({ apiKey: NOTION_KEY })).error).toMatch(/integration secret/i);

    vi.unstubAllGlobals();
    stubFetch({ [NOTION_ME]: { status: 400, body: { message: "path failed validation" } } });
    expect(expectFailed(await notionConnector.test({ apiKey: NOTION_KEY })).error).toMatch(/path failed validation/);

    vi.unstubAllGlobals();
    stubFetch({ [NOTION_ME]: { throws: true } });
    expect(expectFailed(await notionConnector.test({ apiKey: NOTION_KEY })).error).toMatch(/Could not reach Notion/);
  });

  it("refuses a blank secret without calling Notion", async () => {
    const calls = forbidFetch();
    expectFailed(await notionConnector.test({ apiKey: "   " }));
    expect(calls).toHaveLength(0);
  });

  it("picks data sources by searching for the data_source object type", async () => {
    const calls = stubFetch({
      [NOTION_SEARCH]: {
        body: {
          results: [
            { id: "ds_1", title: [{ plain_text: "Leads" }, { plain_text: " 2026" }] },
            { id: "ds_2", title: [] },
          ],
        },
      },
    });

    const options = await notionConnector.pick!("dataSources", { apiKey: NOTION_KEY }, {});

    expect(calls[0]).toMatchObject({ url: NOTION_SEARCH, method: "POST" });
    expect(calls[0].headers["Notion-Version"]).toBe("2026-03-11");
    expect(bodyOf(calls[0])).toEqual({
      filter: { property: "object", value: "data_source" },
      page_size: 100,
    });
    expect(options).toEqual([
      { id: "ds_1", label: "Leads 2026" },
      { id: "ds_2", label: "Untitled" },
    ]);
  });

  it("throws from a failed pick and ignores an unknown kind", async () => {
    stubFetch({ [NOTION_SEARCH]: { status: 403, body: { message: "no access" } } });
    await expect(notionConnector.pick!("dataSources", { apiKey: NOTION_KEY }, {})).rejects.toThrow(/no access/);

    vi.unstubAllGlobals();
    const calls = forbidFetch();
    await expect(notionConnector.pick!("channels", { apiKey: NOTION_KEY }, {})).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Airtable
// ---------------------------------------------------------------------------------------------

const AIRTABLE_KEY = "patAbc123.0123456789abcdef";
const WHOAMI = "https://api.airtable.com/v0/meta/whoami";
const BASES = "https://api.airtable.com/v0/meta/bases";
const TABLES = "https://api.airtable.com/v0/meta/bases/appBase1/tables";

describe("airtable connector", () => {
  it("is a Pro data connector with one secret field", () => {
    expect(airtableConnector).toMatchObject({
      provider: "airtable",
      category: "data",
      kind: "apiKey",
      requiresFeature: "pro_connectors",
      icon: "Table",
    });
    expect(airtableConnector.fields[0]).toMatchObject({ name: "apiKey", kind: "secret" });
  });

  it("validates the token with meta/whoami", async () => {
    const calls = stubFetch({
      [WHOAMI]: { body: { id: "usr1", email: "sam@acme.com", scopes: ["data.records:write"] } },
    });

    const result = expectOk(await airtableConnector.test({ apiKey: AIRTABLE_KEY }));

    expect(calls[0]).toMatchObject({ url: WHOAMI, method: "GET" });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${AIRTABLE_KEY}`);
    expect(result.label).toBe("Airtable (sam@acme.com)");
    expect(result.hint).toBe(AIRTABLE_KEY.slice(-4));
    expect(result.meta).toEqual({
      user_id: "usr1",
      email: "sam@acme.com",
      scopes: ["data.records:write"],
    });
  });

  it("explains a missing scope rather than repeating Airtable's 403", async () => {
    stubFetch({ [WHOAMI]: { status: 403, body: { error: { type: "INVALID_PERMISSIONS" } } } });
    expect(expectFailed(await airtableConnector.test({ apiKey: AIRTABLE_KEY })).error).toMatch(
      /schema\.bases:read/,
    );

    vi.unstubAllGlobals();
    stubFetch({ [WHOAMI]: { status: 401, body: {} } });
    expect(expectFailed(await airtableConnector.test({ apiKey: AIRTABLE_KEY })).error).toMatch(
      /personal access token/i,
    );
  });

  it("picks bases and, for a chosen base, its tables", async () => {
    const calls = stubFetch({
      [BASES]: { body: { bases: [{ id: "appBase1", name: "CRM" }] } },
      [TABLES]: { body: { tables: [{ id: "tbl1", name: "Leads" }, { id: "tbl2" }] } },
    });

    await expect(airtableConnector.pick!("bases", { apiKey: AIRTABLE_KEY }, {})).resolves.toEqual([
      { id: "appBase1", label: "CRM" },
    ]);
    await expect(
      airtableConnector.pick!("tables:appBase1", { apiKey: AIRTABLE_KEY }, {}),
    ).resolves.toEqual([
      { id: "tbl1", label: "Leads" },
      { id: "tbl2", label: "tbl2" },
    ]);

    expect(calls.map((call) => call.url)).toEqual([BASES, TABLES]);
  });

  it("returns nothing for an unknown kind or a base-less tables kind", async () => {
    const calls = forbidFetch();
    await expect(airtableConnector.pick!("teams", { apiKey: AIRTABLE_KEY }, {})).resolves.toEqual([]);
    await expect(airtableConnector.pick!("tables:", { apiKey: AIRTABLE_KEY }, {})).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------------------------

const LINEAR_KEY = "lin_api_0123456789abcdef";
const LINEAR = "https://api.linear.app/graphql";

describe("linear connector", () => {
  it("is a Pro data connector with one secret field", () => {
    expect(linearConnector).toMatchObject({
      provider: "linear",
      category: "data",
      kind: "apiKey",
      requiresFeature: "pro_connectors",
      icon: "SquareKanban",
    });
  });

  it("validates the key with a viewer query sent as a bare Authorization header", async () => {
    const calls = stubFetch({ [LINEAR]: { body: { data: { viewer: { id: "usr1", name: "Sam" } } } } });

    const result = expectOk(await linearConnector.test({ apiKey: LINEAR_KEY }));

    expect(calls[0]).toMatchObject({ url: LINEAR, method: "POST" });
    // The one thing that breaks a Linear personal key: a `Bearer` prefix.
    expect(calls[0].headers.Authorization).toBe(LINEAR_KEY);
    expect(bodyOf(calls[0])).toEqual({ query: "{ viewer { id name } }" });
    expect(result.label).toBe("Linear (Sam)");
    expect(result.meta).toEqual({ user_id: "usr1", name: "Sam" });
  });

  it("reports a rejected key and a GraphQL refusal", async () => {
    stubFetch({ [LINEAR]: { status: 401, body: {} } });
    expect(expectFailed(await linearConnector.test({ apiKey: LINEAR_KEY })).error).toMatch(/API key/i);

    vi.unstubAllGlobals();
    stubFetch({ [LINEAR]: { status: 400, body: { errors: [{ message: "Authentication required" }] } } });
    expect(expectFailed(await linearConnector.test({ apiKey: LINEAR_KEY })).error).toMatch(
      /Authentication required/,
    );
  });

  it("picks teams and labels them with their key", async () => {
    const calls = stubFetch({
      [LINEAR]: {
        body: { data: { teams: { nodes: [{ id: "team_1", name: "Engineering", key: "ENG" }] } } },
      },
    });

    await expect(linearConnector.pick!("teams", { apiKey: LINEAR_KEY }, {})).resolves.toEqual([
      { id: "team_1", label: "Engineering (ENG)" },
    ]);
    expect(bodyOf(calls[0])).toEqual({ query: "{ teams { nodes { id name key } } }" });
  });
});

// ---------------------------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------------------------

const GITHUB_TOKEN = "github_pat_0123456789abcdef";
const GITHUB_USER = "https://api.github.com/user";
const GITHUB_REPO = "https://api.github.com/repos/acme/site";

describe("github connector", () => {
  it("asks for a token and the repository it may write to", () => {
    expect(githubConnector).toMatchObject({
      provider: "github",
      category: "data",
      kind: "apiKey",
      requiresFeature: null,
      icon: "GitBranch",
    });
    expect(githubConnector.fields.map((field) => field.name)).toEqual(["token", "repo"]);
    expect(githubConnector.fields[0].kind).toBe("secret");
    expect(githubConnector.fields[1].kind).toBe("text");
  });

  it("checks the token, then the repository, with the pinned API version and a User-Agent", async () => {
    const calls = stubFetch({
      [GITHUB_USER]: { body: { login: "sam" } },
      [GITHUB_REPO]: { body: { full_name: "acme/site" } },
    });

    const result = expectOk(await githubConnector.test({ token: GITHUB_TOKEN, repo: "acme/site" }));

    expect(calls.map((call) => call.url)).toEqual([GITHUB_USER, GITHUB_REPO]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${GITHUB_TOKEN}`);
      expect(call.headers["X-GitHub-Api-Version"]).toBe("2026-03-10");
      expect(call.headers["User-Agent"]).toBe("papaflow/0.1");
    }

    expect(result.label).toBe("GitHub (acme/site)");
    expect(result.hint).toBe(GITHUB_TOKEN.slice(-4));
    expect(result.meta).toEqual({ login: "sam", repo: "acme/site" });
  });

  it("accepts a pasted repository URL and refuses anything that is not owner/repo", async () => {
    const calls = stubFetch({
      [GITHUB_USER]: { body: { login: "sam" } },
      [GITHUB_REPO]: { body: { full_name: "acme/site" } },
    });

    expectOk(await githubConnector.test({ token: GITHUB_TOKEN, repo: "https://github.com/acme/site" }));
    expect(calls).toHaveLength(2);

    vi.unstubAllGlobals();
    const none = forbidFetch();
    expect(expectFailed(await githubConnector.test({ token: GITHUB_TOKEN, repo: "site" })).error).toMatch(
      /owner\/repo/,
    );
    expect(none).toHaveLength(0);
  });

  it("names the repository when the token cannot reach it", async () => {
    stubFetch({
      [GITHUB_USER]: { body: { login: "sam" } },
      [GITHUB_REPO]: { status: 404, body: { message: "Not Found" } },
    });

    expect(
      expectFailed(await githubConnector.test({ token: GITHUB_TOKEN, repo: "acme/site" })).error,
    ).toMatch(/sam cannot reach acme\/site/);
  });

  it("has no pickers: the repository is the connection", () => {
    expect(githubConnector.pick).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Microsoft Teams
// ---------------------------------------------------------------------------------------------

const TEAMS_URL = "https://prod-00.westeurope.logic.azure.com/workflows/abcd/triggers/manual/paths/invoke";

describe("teams connector", () => {
  it("is a free chat connector holding a webhook URL", () => {
    expect(teamsConnector).toMatchObject({
      provider: "teams",
      category: "chat",
      kind: "webhookUrl",
      requiresFeature: null,
      icon: "Users",
    });
    expect(teamsConnector.fields[0]).toMatchObject({ name: "webhookUrl", kind: "url" });
  });

  it("proves the URL by posting a minimal Adaptive Card and no Authorization header", async () => {
    const calls = stubFetch({ [TEAMS_URL]: { status: 202, text: "" } });

    const result = expectOk(await teamsConnector.test({ webhookUrl: TEAMS_URL }));

    expect(calls[0]).toMatchObject({ url: TEAMS_URL, method: "POST" });
    expect(calls[0].headers.Authorization).toBeUndefined();

    const body = bodyOf(calls[0]) as {
      type: string;
      attachments: { contentType: string; content: Record<string, unknown> }[];
    };
    expect(body.type).toBe("message");
    expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(body.attachments[0].content).toMatchObject({ type: "AdaptiveCard", version: "1.4" });
    expect(body.attachments[0].content.body).toEqual([{ type: "TextBlock", text: "PapaFlow connected" }]);

    expect(result.label).toBe("Microsoft Teams");
    expect(result.hint).toBe(TEAMS_URL.slice(-4));
  });

  it("explains a 403 as the trigger's authentication setting", async () => {
    stubFetch({ [TEAMS_URL]: { status: 403, text: "Forbidden" } });
    expect(expectFailed(await teamsConnector.test({ webhookUrl: TEAMS_URL })).error).toMatch(/Anyone/);
  });

  it("refuses a blank or non-https URL without calling out", async () => {
    const calls = forbidFetch();
    expectFailed(await teamsConnector.test({ webhookUrl: "  " }));
    expectFailed(await teamsConnector.test({ webhookUrl: "http://example.com/hook" }));
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------------------------

const RESEND_KEY = "re_0123456789abcdef";
const RESEND_DOMAINS = "https://api.resend.com/domains";

describe("resend connector", () => {
  it("is a free email connector with one secret field", () => {
    expect(resendConnector).toMatchObject({
      provider: "resend",
      category: "email",
      kind: "apiKey",
      requiresFeature: null,
      icon: "MailCheck",
    });
    expect(resendConnector.fields[0]).toMatchObject({ name: "apiKey", kind: "secret", placeholder: "re_…" });
  });

  it("lists the account's domains and labels the connection with the first verified one", async () => {
    const calls = stubFetch({
      [RESEND_DOMAINS]: {
        body: {
          data: [
            { id: "d1", name: "pending.dev", status: "pending" },
            { id: "d2", name: "mail.acme.com", status: "verified" },
          ],
        },
      },
    });

    const result = expectOk(await resendConnector.test({ apiKey: RESEND_KEY }));

    expect(calls[0]).toMatchObject({ url: RESEND_DOMAINS, method: "GET" });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${RESEND_KEY}`);
    // Resend blocks a request with no User-Agent before it reaches the API (403, error 1010).
    expect(calls[0].headers["User-Agent"]).toBe("papaflow/0.1");

    expect(result.label).toBe("Resend (mail.acme.com)");
    expect(result.hint).toBe(RESEND_KEY.slice(-4));
    expect(result.meta).toEqual({
      domains: [
        { name: "pending.dev", status: "pending" },
        { name: "mail.acme.com", status: "verified" },
      ],
    });
  });

  it("still connects a key whose domains are all unverified", async () => {
    stubFetch({ [RESEND_DOMAINS]: { body: { data: [] } } });

    const result = expectOk(await resendConnector.test({ apiKey: RESEND_KEY }));
    expect(result.label).toBe("Resend (no verified domain)");
    expect(result.meta).toEqual({ domains: [] });
  });

  it("reports a rejected key and an unreachable API", async () => {
    stubFetch({ [RESEND_DOMAINS]: { status: 401, body: {} } });
    expect(expectFailed(await resendConnector.test({ apiKey: RESEND_KEY })).error).toMatch(/API key/i);

    vi.unstubAllGlobals();
    stubFetch({ [RESEND_DOMAINS]: { throws: true } });
    expect(expectFailed(await resendConnector.test({ apiKey: RESEND_KEY })).error).toMatch(/Could not reach Resend/);
  });

  it("refuses a blank key without calling Resend", async () => {
    const calls = forbidFetch();
    expectFailed(await resendConnector.test({ apiKey: "" }));
    expect(calls).toHaveLength(0);
  });
});
