import { afterEach, describe, expect, it, vi } from "vitest";

import { airtableCreateRecordNode } from "@/nodes/actions/airtable-create-record";
import { githubCreateIssueNode } from "@/nodes/actions/github-create-issue";
import { linearCreateIssueNode } from "@/nodes/actions/linear-create-issue";
import { notionCreatePageNode } from "@/nodes/actions/notion-create-page";
import { teamsPostCardNode } from "@/nodes/actions/teams-post-card";
import { ConnectorError, type RunContext } from "@/nodes/define";
import { toJsonSchema } from "@/nodes/schema";

/**
 * The five data/chat action nodes, each run against a routing table of mocked responses.
 *
 * What is asserted is what the provider actually refuses without: Notion's `Notion-Version` and
 * `parent.data_source_id`, Airtable's `typecast: true`, Linear's bare `Authorization`, GitHub's
 * `User-Agent` and API version. The other half is the rate-limit mapping — a node that reports the
 * wrong status makes the engine either retry a permanent failure or fail a temporary one
 * (CLAUDE.md rule 7).
 */

type Route = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> };
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
      return new Response(route.text ?? JSON.stringify(route.body ?? {}), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json", ...route.headers },
      });
    }),
  );
  return calls;
}

function ctx<I>(inputs: I, credential?: Record<string, unknown>): RunContext<I> {
  return {
    inputs,
    credential,
    orgId: "org_test",
    executionId: "exec_test",
    nodeId: "node_test",
  };
}

async function caught(promise: Promise<unknown>): Promise<ConnectorError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the node run to reject");
    },
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ConnectorError);
  return error as ConnectorError;
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(call.body ?? "{}") as Record<string, unknown>;
}

/** What the config panel reads to decide a field gets a dropdown instead of a text box. */
function pickerOf(node: { inputs: Parameters<typeof toJsonSchema>[0] }, field: string): unknown {
  const schema = toJsonSchema(node.inputs) as { properties?: Record<string, { picker?: unknown }> };
  return schema.properties?.[field]?.picker;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// notion.createPage
// ---------------------------------------------------------------------------------------------

const NOTION_SCHEMA = "https://api.notion.com/v1/data_sources/ds_1";
const NOTION_PAGES = "https://api.notion.com/v1/pages";
const NOTION_CREDENTIAL = { provider: "notion", kind: "apiKey", apiKey: "ntn_secret_key" };

const NOTION_DATA_SOURCE: Route = {
  body: {
    id: "ds_1",
    properties: {
      Notes: { type: "rich_text" },
      Headline: { type: "title" },
    },
  },
};

describe("notion.createPage", () => {
  it("is an action needing a Notion connection and offers a data-source picker", () => {
    expect(notionCreatePageNode).toMatchObject({
      type: "notion.createPage",
      category: "data",
      credential: "notion",
      requiresFeature: null,
      icon: "FileText",
    });
    expect(pickerOf(notionCreatePageNode, "dataSourceId")).toBe("dataSources");
  });

  it("discovers the title property, then creates the page under the data source", async () => {
    const calls = stubFetch({
      [NOTION_SCHEMA]: NOTION_DATA_SOURCE,
      [NOTION_PAGES]: { body: { id: "page_1", url: "https://notion.so/page_1" } },
    });

    const out = await notionCreatePageNode.run(
      ctx(
        notionCreatePageNode.inputs.parse({
          connectionId: "conn_1",
          dataSourceId: "ds_1",
          title: "New lead",
          properties: [{ key: "Notes", value: "from the form" }],
        }),
        NOTION_CREDENTIAL,
      ),
    );

    expect(out).toEqual({ id: "page_1", url: "https://notion.so/page_1" });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${NOTION_SCHEMA}`,
      `POST ${NOTION_PAGES}`,
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe("Bearer ntn_secret_key");
      expect(call.headers["Notion-Version"]).toBe("2026-03-11");
    }

    expect(bodyOf(calls[1])).toEqual({
      parent: { data_source_id: "ds_1" },
      properties: {
        Notes: { rich_text: [{ text: { content: "from the form" } }] },
        Headline: { title: [{ text: { content: "New lead" } }] },
      },
    });
  });

  it("never lets a property row overwrite the title column", async () => {
    const calls = stubFetch({
      [NOTION_SCHEMA]: NOTION_DATA_SOURCE,
      [NOTION_PAGES]: { body: { id: "page_1", url: "https://notion.so/page_1" } },
    });

    await notionCreatePageNode.run(
      ctx(
        notionCreatePageNode.inputs.parse({
          connectionId: "conn_1",
          dataSourceId: "ds_1",
          title: "Wins",
          properties: [{ key: "Headline", value: "sneaky" }],
        }),
        NOTION_CREDENTIAL,
      ),
    );

    const properties = bodyOf(calls[1]).properties as Record<string, unknown>;
    expect(properties.Headline).toEqual({ title: [{ text: { content: "Wins" } }] });
  });

  it("maps a 429 onto a retryable ConnectorError carrying Notion's Retry-After", async () => {
    stubFetch({
      [NOTION_SCHEMA]: NOTION_DATA_SOURCE,
      [NOTION_PAGES]: { status: 429, text: "rate limited", headers: { "retry-after": "12" } },
    });

    const error = await caught(
      notionCreatePageNode.run(
        ctx(
          notionCreatePageNode.inputs.parse({
            connectionId: "conn_1",
            dataSourceId: "ds_1",
            title: "New lead",
          }),
          NOTION_CREDENTIAL,
        ),
      ),
    );

    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("12");
  });

  it("refuses a data source with no title property, and a run with no connection", async () => {
    stubFetch({ [NOTION_SCHEMA]: { body: { properties: { Notes: { type: "rich_text" } } } } });

    const inputs = notionCreatePageNode.inputs.parse({
      connectionId: "conn_1",
      dataSourceId: "ds_1",
      title: "New lead",
    });

    expect((await caught(notionCreatePageNode.run(ctx(inputs, NOTION_CREDENTIAL)))).status).toBe(400);

    const noCredential = await caught(notionCreatePageNode.run(ctx(inputs)));
    expect(noCredential.status).toBe(400);
    expect(noCredential.message).toMatch(/Notion connection/);
  });
});

// ---------------------------------------------------------------------------------------------
// airtable.createRecord
// ---------------------------------------------------------------------------------------------

const AIRTABLE_RECORDS = "https://api.airtable.com/v0/appBase1/tblLeads";
const AIRTABLE_CREDENTIAL = { provider: "airtable", kind: "apiKey", apiKey: "pat_key" };

function airtableInputs(): unknown {
  return airtableCreateRecordNode.inputs.parse({
    connectionId: "conn_1",
    baseId: "appBase1",
    tableId: "tblLeads",
    fields: [
      { key: "Name", value: "Sam" },
      { key: "Score", value: "7" },
    ],
  });
}

describe("airtable.createRecord", () => {
  it("offers a base picker and a table picker keyed on the chosen base", () => {
    expect(airtableCreateRecordNode).toMatchObject({
      type: "airtable.createRecord",
      category: "data",
      credential: "airtable",
      icon: "Table",
    });
    expect(pickerOf(airtableCreateRecordNode, "baseId")).toBe("bases");
    expect(pickerOf(airtableCreateRecordNode, "tableId")).toBe("tables:{baseId}");
  });

  it("posts one record with typecast so template strings land in typed columns", async () => {
    const calls = stubFetch({
      [AIRTABLE_RECORDS]: { body: { records: [{ id: "rec1", fields: {} }] } },
    });

    const out = await airtableCreateRecordNode.run(
      ctx(airtableInputs() as never, AIRTABLE_CREDENTIAL),
    );

    expect(out).toEqual({ id: "rec1" });
    expect(calls[0]).toMatchObject({ url: AIRTABLE_RECORDS, method: "POST" });
    expect(calls[0].headers.Authorization).toBe("Bearer pat_key");
    expect(bodyOf(calls[0])).toEqual({
      records: [{ fields: { Name: "Sam", Score: "7" } }],
      typecast: true,
    });
  });

  it("turns a 429 into a 30 second wait when Airtable sends no Retry-After", async () => {
    stubFetch({ [AIRTABLE_RECORDS]: { status: 429, text: "RATE_LIMIT_REACHED" } });

    const error = await caught(
      airtableCreateRecordNode.run(ctx(airtableInputs() as never, AIRTABLE_CREDENTIAL)),
    );

    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("30s");
  });

  it("prefers Airtable's own Retry-After when it sends one", async () => {
    stubFetch({
      [AIRTABLE_RECORDS]: { status: 429, text: "slow down", headers: { "retry-after": "5" } },
    });

    const error = await caught(
      airtableCreateRecordNode.run(ctx(airtableInputs() as never, AIRTABLE_CREDENTIAL)),
    );
    expect(error.retryAfter).toBe("5");
  });

  it("reports a 422 as the user's to fix and a missing connection as a 400", async () => {
    stubFetch({ [AIRTABLE_RECORDS]: { status: 422, text: "INVALID_VALUE_FOR_COLUMN" } });

    const error = await caught(
      airtableCreateRecordNode.run(ctx(airtableInputs() as never, AIRTABLE_CREDENTIAL)),
    );
    expect(error.status).toBe(422);
    expect(error.message).toContain("INVALID_VALUE_FOR_COLUMN");

    const noCredential = await caught(airtableCreateRecordNode.run(ctx(airtableInputs() as never)));
    expect(noCredential.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------
// linear.createIssue
// ---------------------------------------------------------------------------------------------

const LINEAR = "https://api.linear.app/graphql";
const LINEAR_CREDENTIAL = { provider: "linear", kind: "apiKey", apiKey: "lin_api_key" };

function linearInputs(description?: string): unknown {
  return linearCreateIssueNode.inputs.parse({
    connectionId: "conn_1",
    teamId: "team_1",
    title: "Site is down",
    ...(description ? { description } : {}),
  });
}

describe("linear.createIssue", () => {
  it("offers a team picker and needs a Linear connection", () => {
    expect(linearCreateIssueNode).toMatchObject({
      type: "linear.createIssue",
      category: "data",
      credential: "linear",
      icon: "SquareKanban",
    });
    expect(pickerOf(linearCreateIssueNode, "teamId")).toBe("teams");
  });

  it("sends issueCreate with the bare key and returns the issue's identifier", async () => {
    const calls = stubFetch({
      [LINEAR]: {
        body: {
          data: {
            issueCreate: {
              success: true,
              issue: { id: "iss_1", identifier: "ENG-12", url: "https://linear.app/x/ENG-12" },
            },
          },
        },
      },
    });

    const out = await linearCreateIssueNode.run(
      ctx(linearInputs("everything is on fire") as never, LINEAR_CREDENTIAL),
    );

    expect(out).toEqual({ id: "iss_1", identifier: "ENG-12", url: "https://linear.app/x/ENG-12" });
    expect(calls[0]).toMatchObject({ url: LINEAR, method: "POST" });
    expect(calls[0].headers.Authorization).toBe("lin_api_key");

    const body = bodyOf(calls[0]) as { query: string; variables: { input: Record<string, unknown> } };
    expect(body.query).toContain("issueCreate");
    expect(body.variables.input).toEqual({
      teamId: "team_1",
      title: "Site is down",
      description: "everything is on fire",
    });
  });

  it("omits an empty description rather than sending an empty string", async () => {
    const calls = stubFetch({
      [LINEAR]: { body: { data: { issueCreate: { success: true, issue: { id: "iss_1" } } } } },
    });

    await linearCreateIssueNode.run(ctx(linearInputs() as never, LINEAR_CREDENTIAL));

    const body = bodyOf(calls[0]) as { variables: { input: Record<string, unknown> } };
    expect(body.variables.input).toEqual({ teamId: "team_1", title: "Site is down" });
  });

  it("maps RATELIMITED — which Linear sends as HTTP 400 — onto a retryable 429", async () => {
    stubFetch({
      [LINEAR]: {
        status: 400,
        body: {
          errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }],
        },
      },
    });

    const error = await caught(
      linearCreateIssueNode.run(ctx(linearInputs() as never, LINEAR_CREDENTIAL)),
    );

    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("60s");
    expect(error.message).toBe("Rate limit exceeded");
  });

  it("leaves every other GraphQL error as the user's to fix", async () => {
    stubFetch({
      [LINEAR]: {
        status: 400,
        body: { errors: [{ message: "Team not found", extensions: { code: "INVALID_INPUT" } }] },
      },
    });

    const error = await caught(
      linearCreateIssueNode.run(ctx(linearInputs() as never, LINEAR_CREDENTIAL)),
    );
    expect(error.status).toBe(400);
    expect(error.retryAfter).toBeUndefined();
  });

  it("refuses a 200 that created nothing", async () => {
    stubFetch({ [LINEAR]: { body: { data: { issueCreate: { success: false } } } } });

    const error = await caught(
      linearCreateIssueNode.run(ctx(linearInputs() as never, LINEAR_CREDENTIAL)),
    );
    expect(error.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------------------------
// github.createIssue
// ---------------------------------------------------------------------------------------------

const GITHUB_ISSUES = "https://api.github.com/repos/acme/site/issues";
const GITHUB_CREDENTIAL = {
  provider: "github",
  kind: "apiKey",
  token: "github_pat_key",
  repo: "acme/site",
};

function githubInputs(labels: string[] = []): unknown {
  return githubCreateIssueNode.inputs.parse({
    connectionId: "conn_1",
    title: "Broken link",
    body: "on /pricing",
    labels,
  });
}

describe("github.createIssue", () => {
  it("takes the repository from the connection, not from the graph", () => {
    expect(githubCreateIssueNode).toMatchObject({
      type: "github.createIssue",
      category: "data",
      credential: "github",
      icon: "CircleDot",
    });
    const schema = toJsonSchema(githubCreateIssueNode.inputs) as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {})).toEqual(["connectionId", "title", "body", "labels"]);
  });

  it("posts the issue with the pinned API version, a User-Agent and its labels", async () => {
    const calls = stubFetch({
      [GITHUB_ISSUES]: {
        status: 201,
        body: { number: 42, html_url: "https://github.com/acme/site/issues/42" },
      },
    });

    const out = await githubCreateIssueNode.run(
      ctx(githubInputs(["bug"]) as never, GITHUB_CREDENTIAL),
    );

    expect(out).toEqual({ number: 42, url: "https://github.com/acme/site/issues/42" });
    expect(calls[0]).toMatchObject({ url: GITHUB_ISSUES, method: "POST" });
    expect(calls[0].headers.Authorization).toBe("Bearer github_pat_key");
    expect(calls[0].headers["X-GitHub-Api-Version"]).toBe("2026-03-10");
    expect(calls[0].headers["User-Agent"]).toBe("papaflow/0.1");
    expect(bodyOf(calls[0])).toEqual({ title: "Broken link", body: "on /pricing", labels: ["bug"] });
  });

  it("omits labels entirely when none were chosen", async () => {
    const calls = stubFetch({ [GITHUB_ISSUES]: { status: 201, body: { number: 1, html_url: "u" } } });

    await githubCreateIssueNode.run(ctx(githubInputs() as never, GITHUB_CREDENTIAL));

    expect(bodyOf(calls[0])).toEqual({ title: "Broken link", body: "on /pricing" });
  });

  it("treats a 403 with Retry-After as the secondary rate limit, and one without as a refusal", async () => {
    stubFetch({
      [GITHUB_ISSUES]: { status: 403, text: "too fast", headers: { "retry-after": "60" } },
    });
    const throttled = await caught(
      githubCreateIssueNode.run(ctx(githubInputs() as never, GITHUB_CREDENTIAL)),
    );
    expect(throttled.status).toBe(429);
    expect(throttled.retryAfter).toBe("60");

    vi.unstubAllGlobals();
    stubFetch({ [GITHUB_ISSUES]: { status: 403, text: "Resource not accessible by personal access token" } });
    const refused = await caught(
      githubCreateIssueNode.run(ctx(githubInputs() as never, GITHUB_CREDENTIAL)),
    );
    expect(refused.status).toBe(403);
    expect(refused.retryAfter).toBeUndefined();
  });

  it("maps a 429 onto a retryable error even when GitHub sends no header", async () => {
    stubFetch({ [GITHUB_ISSUES]: { status: 429, text: "slow down" } });

    const error = await caught(
      githubCreateIssueNode.run(ctx(githubInputs() as never, GITHUB_CREDENTIAL)),
    );
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("60s");
  });

  it("refuses a connection with no repository or a malformed one", async () => {
    const noCredential = await caught(githubCreateIssueNode.run(ctx(githubInputs() as never)));
    expect(noCredential.status).toBe(400);

    const malformed = await caught(
      githubCreateIssueNode.run(
        ctx(githubInputs() as never, { ...GITHUB_CREDENTIAL, repo: "not-a-repo" }),
      ),
    );
    expect(malformed.status).toBe(400);
    expect(malformed.message).toMatch(/owner\/repo/);
  });
});

// ---------------------------------------------------------------------------------------------
// teams.postCard
// ---------------------------------------------------------------------------------------------

const TEAMS_URL = "https://prod-00.westeurope.logic.azure.com/workflows/abcd";
const TEAMS_CREDENTIAL = { provider: "teams", kind: "webhookUrl", webhookUrl: TEAMS_URL };

function teamsInputs(): unknown {
  return teamsPostCardNode.inputs.parse({
    connectionId: "conn_1",
    title: "Deploy finished",
    text: "papaflow@abc123 is live",
  });
}

describe("teams.postCard", () => {
  it("keeps the webhook URL in the credential, never in the inputs", () => {
    expect(teamsPostCardNode).toMatchObject({
      type: "teams.postCard",
      category: "chat",
      credential: "teams",
      icon: "Users",
    });
    const schema = toJsonSchema(teamsPostCardNode.inputs) as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {})).toEqual(["connectionId", "title", "text"]);
  });

  it("posts an Adaptive Card 1.4 with a heading and the text, and no Authorization header", async () => {
    const calls = stubFetch({ [TEAMS_URL]: { status: 202, text: "" } });

    await expect(teamsPostCardNode.run(ctx(teamsInputs() as never, TEAMS_CREDENTIAL))).resolves.toEqual({
      ok: true,
    });

    expect(calls[0]).toMatchObject({ url: TEAMS_URL, method: "POST" });
    expect(calls[0].headers.Authorization).toBeUndefined();

    const body = bodyOf(calls[0]) as {
      type: string;
      attachments: { contentType: string; content: { version: string; body: unknown[] } }[];
    };
    expect(body.type).toBe("message");
    expect(body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(body.attachments[0].content.version).toBe("1.4");
    expect(body.attachments[0].content.body).toEqual([
      { type: "TextBlock", text: "Deploy finished", weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text: "papaflow@abc123 is live", wrap: true },
    ]);
  });

  it("surfaces a throttled post as a retryable 429 and a missing connection as a 400", async () => {
    stubFetch({ [TEAMS_URL]: { status: 429, text: "throttled", headers: { "retry-after": "1" } } });

    const error = await caught(teamsPostCardNode.run(ctx(teamsInputs() as never, TEAMS_CREDENTIAL)));
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe("1");

    const noCredential = await caught(teamsPostCardNode.run(ctx(teamsInputs() as never)));
    expect(noCredential.status).toBe(400);
    expect(noCredential.message).toMatch(/Teams connection/);
  });
});
