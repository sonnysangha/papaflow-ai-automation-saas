import { describe, expect, it } from "vitest";

import {
  buildConnectorTools,
  connectorToolCalls,
  type ToolConnection,
} from "@/agents/runtime/lib/connector-tools";

/**
 * The Runtime agent's tool list, as a pure function of one org's connections.
 *
 * This is the whole reason `buildConnectorTools` lives in `agents/runtime/lib/` rather than inside
 * the `defineDynamic` resolver: the interesting decisions — what a tool is called, which ones a plan
 * may see, and what a descriptor is allowed to contain — are decisions about a list, and they can be
 * checked without a session, a Convex deployment or a model.
 */

const SECRET = "xoxb-not-a-real-token";

function connection(overrides: Partial<ToolConnection> & { provider: string }): ToolConnection {
  return {
    id: `conn_${overrides.provider}`,
    label: `${overrides.provider} workspace`,
    status: "active",
    ...overrides,
  };
}

function build(plan: string, connections: readonly ToolConnection[]) {
  return buildConnectorTools({ orgId: "org_1", plan, executionId: "exec_1", connections });
}

describe("buildConnectorTools", () => {
  it("always offers http_request, even for an org with no connections at all", () => {
    expect(Object.keys(build("pro", []))).toEqual(["http_request"]);
  });

  it("names each connector tool by its bare key", () => {
    const tools = build("pro", [
      connection({ provider: "slack" }),
      connection({ provider: "telegram" }),
      connection({ provider: "notion" }),
      connection({ provider: "discord-webhook" }),
    ]);

    expect(Object.keys(tools).sort()).toEqual([
      "discord_post",
      "http_request",
      "notion_create_page",
      "slack_post",
      "telegram_send",
    ]);
  });

  it("treats the two Discord connection kinds as one tool", () => {
    expect(Object.keys(build("pro", [connection({ provider: "discord-bot" })]))).toContain(
      "discord_post",
    );
    expect(Object.keys(build("pro", [connection({ provider: "discord-webhook" })]))).toContain(
      "discord_post",
    );
  });

  it("offers nothing for a connection the org does not have", () => {
    const tools = build("pro", [connection({ provider: "telegram" })]);

    expect(Object.keys(tools).sort()).toEqual(["http_request", "telegram_send"]);
  });

  it("skips a connection that is not active", () => {
    const tools = build("pro", [
      connection({ provider: "slack", status: "needs_reconnect" }),
      connection({ provider: "telegram", status: "revoked" }),
    ]);

    expect(Object.keys(tools)).toEqual(["http_request"]);
  });

  it("withholds the Pro connectors from a free organisation", () => {
    const connections = [
      connection({ provider: "slack" }),
      connection({ provider: "notion" }),
      connection({ provider: "telegram" }),
      connection({ provider: "discord-bot" }),
    ];

    // Free covers `core_connectors` only; Slack and Notion are `pro_connectors` nodes.
    expect(Object.keys(build("free_org", connections)).sort()).toEqual([
      "discord_post",
      "http_request",
      "telegram_send",
    ]);
    expect(Object.keys(build("pro", connections))).toHaveLength(5);
  });

  it("withholds a connection whose own row demands a feature the plan lacks", () => {
    const tools = build("free_org", [
      connection({ provider: "telegram", requiresFeature: "pro_connectors" }),
    ]);

    expect(Object.keys(tools)).toEqual(["http_request"]);
  });

  it("falls back to the free plan's features for a plan slug it has never heard of", () => {
    const tools = build("enterprise_platinum", [connection({ provider: "slack" })]);

    expect(Object.keys(tools)).toEqual(["http_request"]);
  });

  it("uses the newest active connection when the org has several for one provider", () => {
    // `listOrgConnections` returns newest first, so the first match is the newest.
    const tools = build("pro", [
      connection({ provider: "slack", id: "conn_new", label: "New workspace" }),
      connection({ provider: "slack", id: "conn_old", label: "Old workspace" }),
    ]);

    expect(tools.slack_post.description).toContain("New workspace");
    expect(tools.slack_post.description).not.toContain("Old workspace");
  });

  it("hides the connection and the auth mode from the tool's own input schema", async () => {
    const tools = build("pro", [connection({ provider: "slack" })]);

    // The agent chooses what to say, never which credential says it (CLAUDE.md rule 1).
    const slack = await slackInput(tools, { channel: "#general", text: "hi", connectionId: "x" });
    expect(slack).toEqual({ channel: "#general", text: "hi" });

    const http = tools.http_request.inputSchema as unknown as {
      shape: Record<string, unknown>;
    };
    expect(Object.keys(http.shape).sort()).toEqual(["body", "headers", "method", "url"]);
  });

  it("puts nothing secret-shaped in a descriptor, which is persisted in the durable session", () => {
    const tools = build("pro", [
      connection({ provider: "slack", label: "Acme" }),
      connection({ provider: "telegram", label: "Acme bot" }),
    ]);

    const descriptors = JSON.stringify(
      Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description })),
    );

    expect(descriptors).not.toContain(SECRET);
    expect(descriptors).not.toMatch(/token|apiKey|secret/i);
    // Ids and labels are the only connection facts a description may carry.
    expect(descriptors).toContain("Acme");
  });

  it("captures only JSON-serialisable values, so eve can persist every descriptor", () => {
    // eve's bundler snapshots each `execute` closure into a durable descriptor and rejects the
    // *whole* resolver result — every tool, not just the offending one — if any captured value is a
    // function, a class instance, a Date, a Map or cyclic. A `ToolSpec` is all three of the first
    // kinds (a zod schema, a `run`, a `describe`), which is why `execute` closes over nothing but the
    // flat call payload and looks the spec up from module scope. A round trip that comes back
    // strictly equal is the closest static check there is that the payload stayed flat.
    const connections = [
      connection({ provider: "slack" }),
      connection({ provider: "telegram" }),
      connection({ provider: "notion" }),
      connection({ provider: "discord-webhook" }),
    ];
    const input = { orgId: "org_1", plan: "pro", executionId: "exec_1", connections };
    const calls = connectorToolCalls(input);

    // Every offered tool has a payload, or the guard is checking an empty list.
    expect(calls.map((call) => call.toolName).sort()).toEqual(
      Object.keys(buildConnectorTools(input)).sort(),
    );

    for (const call of calls) {
      // `toStrictEqual`, not `toEqual`: it also fails on a dropped `undefined` property and on a
      // value whose prototype changed, which is exactly how a non-plain capture would show up.
      expect(JSON.parse(JSON.stringify(call))).toStrictEqual(call);
    }

    // `http_request` is the credential-less one; `null` rather than `undefined` so it survives.
    const http = calls.find((call) => call.toolName === "http_request");
    expect(http).toStrictEqual({
      toolName: "http_request",
      orgId: "org_1",
      executionId: "exec_1",
      plan: "pro",
      connectionId: null,
      connectionLabel: "",
    });
  });
});

/** Parses an input through a tool's schema, which is the node's schema minus the hidden fields. */
async function slackInput(
  tools: ReturnType<typeof build>,
  value: Record<string, unknown>,
): Promise<unknown> {
  // `PublicToolInputSchema` is the Standard Schema union, so the zod object underneath is only
  // reachable through `unknown` — the test wants the runtime behaviour, not the declared type.
  const schema = tools.slack_post.inputSchema as unknown as {
    parse: (input: unknown) => unknown;
  };
  return schema.parse(value);
}
