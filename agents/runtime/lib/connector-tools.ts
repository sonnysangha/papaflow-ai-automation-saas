import type { ToolDefinition } from "eve/tools";
import { defineTool } from "eve/tools";
import type { z } from "zod";

import { openOrgConnection } from "@/lib/connections-engine";
import { featuresForPlan } from "@/lib/plans";
import { discordPostNode } from "@/nodes/actions/discord-post";
import { httpRequest } from "@/nodes/actions/http-request";
import { notionCreatePageNode } from "@/nodes/actions/notion-create-page";
import { slackPostNode } from "@/nodes/actions/slack-post";
import { telegramSendNode } from "@/nodes/actions/telegram-send";
import type { NodeDef } from "@/nodes/define";

/**
 * The Runtime agent's connector tools, built from one organisation's connections.
 *
 * Kept out of `tools/` on purpose: eve registers every file under `agents/<name>/tools/` as a tool
 * named after its slug, so a helper module has to live in `lib/` (the layout the eve docs prescribe
 * for shared executable helpers). `tools/connectors.ts` is the thin `defineDynamic` wrapper; this is
 * the part with the rules in it, and the part the unit tests exercise as a pure function.
 *
 * Three rules shape it:
 *
 * 1. **A tool is the node.** Every `execute` calls the same `run()` the canvas node calls, through
 *    the same zod schema, so "post to Slack" behaves identically whether a person drew it or the
 *    agent decided it. Adding a connector to the agent is a line in `TOOLS` below.
 * 2. **Closures hold ids, never secrets.** A dynamic tool descriptor is persisted in the durable
 *    session, so the only things captured here are a connection id, a label and the org id; the
 *    credential is opened inside `execute`, per call (CLAUDE.md rule 1).
 * 3. **The plan gates the list.** A connector whose node needs a feature the org's plan lacks is not
 *    offered at all — the model cannot be tempted by a tool that `runNode` would refuse anyway
 *    (CLAUDE.md rule 3).
 */

/** One of the org's connections, as the resolver hands it over. Never secret-bearing. */
export type ToolConnection = {
  id: string;
  provider: string;
  label: string;
  status: string;
  requiresFeature?: string | null;
};

export type BuildConnectorToolsInput = {
  orgId: string;
  /** The plan slug from the session's auth attributes; an unknown one falls back to `free_org`. */
  plan: string;
  /** The execution this session was started for, for the run context a node's `run` receives. */
  executionId: string;
  connections: readonly ToolConnection[];
};

/** What `defineDynamic` returns for the tools slot: names mapped to tool definitions. */
export type ConnectorToolSet = Record<string, ToolDefinition>;

/**
 * A node reduced to what a tool needs from it. `AnyNodeDef` erases the schemas to `any`, which is
 * exactly wrong here: the tool's input schema is the node's, minus the fields the agent must not
 * choose, and that only type-checks while the concrete definition is still concrete.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConnectorNode = NodeDef<z.ZodObject<any>, z.ZodType<any, any>>;

type ToolSpec = {
  /** The bare tool name. A dynamic map names each entry by its key — there is no slug prefix. */
  name: string;
  /** Connection providers that can drive this tool; the first active one the org has wins. */
  providers: readonly string[];
  node: ConnectorNode;
  /** Node inputs the agent may not set: the connection, and anything the tool decides itself. */
  hidden: readonly string[];
  /** Values forced on every call, whatever the model asked for. */
  fixed?: Record<string, unknown>;
  /** `(label) => description`; the label names which workspace/bot/database this is. */
  describe: (label: string) => string;
};

const TOOLS: readonly ToolSpec[] = [
  {
    name: "slack_post",
    providers: ["slack"],
    node: slackPostNode,
    hidden: ["connectionId"],
    describe: (label) =>
      `Post a message to a channel in the Slack workspace "${label}". ` +
      "`channel` is a channel id, a #name, or a user id.",
  },
  {
    name: "discord_post",
    providers: ["discord-webhook", "discord-bot"],
    node: discordPostNode,
    hidden: ["connectionId"],
    describe: (label) =>
      `Post a message or embed to Discord through the connection "${label}". ` +
      "A webhook connection always posts to its own channel; a bot connection needs `channelId`.",
  },
  {
    name: "telegram_send",
    providers: ["telegram"],
    node: telegramSendNode,
    hidden: ["connectionId"],
    describe: (label) =>
      `Send a message as the Telegram bot "${label}". ` +
      "`chatId` is a numeric chat id or an @channel the bot can already reach.",
  },
  {
    name: "notion_create_page",
    providers: ["notion"],
    node: notionCreatePageNode,
    hidden: ["connectionId"],
    describe: (label) =>
      `Create a page (a database row) in the Notion workspace "${label}". ` +
      "`dataSourceId` names the database's data source.",
  },
];

/**
 * The one tool that is always there: any public HTTP API, with no credential attached.
 *
 * `auth` and `authHeader` are hidden and forced to `"none"` rather than offered — the node can
 * authenticate a request from one of the org's connections, and a model choosing which credential to
 * attach to which URL is precisely the decision that must not be delegated.
 */
const HTTP_TOOL: ToolSpec = {
  name: "http_request",
  providers: [],
  node: httpRequest,
  hidden: ["connectionId", "auth", "authHeader"],
  fixed: { auth: "none" },
  describe: () =>
    "Call a public HTTP API and return its status, headers and body. Sends no credentials, " +
    "so it cannot reach anything that needs a login.",
};

/** The plan's feature slugs, or the default plan's when the claim named a plan we do not know. */
function featuresFor(plan: string): readonly string[] {
  return featuresForPlan(plan);
}

/** Whether the org's plan covers everything this tool would touch: the node's gate and the row's. */
function isAllowed(
  spec: ToolSpec,
  connection: ToolConnection | undefined,
  features: readonly string[],
): boolean {
  const required = [spec.node.requiresFeature, connection?.requiresFeature].filter(
    (feature): feature is string => typeof feature === "string" && feature.length > 0,
  );
  return required.every((feature) => features.includes(feature));
}

/** The tool's own input schema: the node's, minus the fields the agent is not allowed to choose. */
function toolInputSchema(spec: ToolSpec): z.ZodType {
  const hidden = Object.fromEntries(spec.hidden.map((field) => [field, true as const]));
  return spec.node.inputs.omit(hidden);
}

/**
 * Runs one connector node exactly as `workflows/steps/run-node.ts` would, with the credential opened
 * here and nowhere else.
 *
 * `credential` is the same `{ provider, kind, meta?, ...secret }` shape `runNode#openCredential`
 * builds, because the node bodies read their token off it by name. It is created inside this
 * function and referenced by nothing after it returns.
 */
async function runConnectorNode(
  spec: ToolSpec,
  args: { orgId: string; executionId: string; connectionId?: string; inputs: Record<string, unknown> },
): Promise<unknown> {
  const credential = args.connectionId
    ? await (async () => {
        const opened = await openOrgConnection(args.connectionId as string, args.orgId);
        return {
          provider: opened.provider,
          kind: opened.kind,
          ...(opened.meta ? { meta: opened.meta } : {}),
          ...opened.secret,
        };
      })()
    : undefined;

  const inputs = spec.node.inputs.parse({
    ...args.inputs,
    ...(args.connectionId ? { connectionId: args.connectionId } : {}),
    ...spec.fixed,
  });

  return await spec.node.run({
    inputs,
    credential,
    orgId: args.orgId,
    executionId: args.executionId,
    nodeId: spec.name,
  });
}

/** The newest active connection for any of a tool's providers, or undefined when there is none. */
function connectionFor(
  spec: ToolSpec,
  connections: readonly ToolConnection[],
): ToolConnection | undefined {
  return connections.find(
    (connection) => connection.status === "active" && spec.providers.includes(connection.provider),
  );
}

/**
 * The tools this session gets: `http_request`, plus one per connector the org has an active,
 * plan-covered connection for.
 *
 * Pure — no I/O, no `ctx` — so the naming, the gating and the "nothing secret in a descriptor" rule
 * are all unit-testable against a fake connection list.
 */
export function buildConnectorTools(input: BuildConnectorToolsInput): ConnectorToolSet {
  const features = featuresFor(input.plan);
  const tools: ConnectorToolSet = {};

  for (const spec of [...TOOLS, HTTP_TOOL]) {
    const connection = spec.providers.length > 0 ? connectionFor(spec, input.connections) : undefined;
    // A connector tool without a connection has nothing to authenticate with; `http_request` is the
    // one entry that never wanted one.
    if (spec.providers.length > 0 && !connection) continue;
    if (!isAllowed(spec, connection, features)) continue;

    tools[spec.name] = defineTool({
      description: spec.describe(connection?.label ?? ""),
      inputSchema: toolInputSchema(spec),
      async execute(rawInput) {
        return await runConnectorNode(spec, {
          orgId: input.orgId,
          executionId: input.executionId,
          connectionId: connection?.id,
          inputs: (rawInput ?? {}) as Record<string, unknown>,
        });
      },
    }) as ToolDefinition;
  }

  return tools;
}
