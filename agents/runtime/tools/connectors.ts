import { defineDynamic } from "eve/tools";

import { listOrgConnections } from "../../../lib/connections-engine";
import { DEFAULT_PLAN } from "../../../lib/plans";

import { buildConnectorTools, type ConnectorToolSet } from "../lib/connector-tools";

/**
 * The org's connectors, resolved once per session.
 *
 * `session.started` is the right scope: the tool list is a property of who opened the session, not of
 * what they are asking, and re-resolving per turn would re-read Convex for nothing. The map's keys
 * are the tool names verbatim — a dynamic map "names each entry by its bare key; there is no
 * automatic slug prefix" — so this file's own slug (`connectors`) never appears in a tool name.
 *
 * Everything durable-tool-shaped is deliberately absent: `ask()`, `sleep` and `createHook` belong in
 * static files under `tools/`, never in a tool a resolver returns (CLAUDE.md rule 8).
 *
 * `orgId` comes from the authenticated principal, never from the model or the message. A session
 * that authenticated with no org — `localDev()` during `eve dev`, which yields
 * `principalType: "local-dev"` and no attributes at all — gets `http_request` and nothing else,
 * because there is no organisation whose connections it could be allowed to use.
 */

/** Auth attributes are `string | readonly string[]`; every claim this agent reads is a string. */
function attribute(
  attributes: Readonly<Record<string, string | readonly string[]>> | undefined,
  name: string,
): string {
  const value = attributes?.[name];
  return typeof value === "string" ? value : "";
}

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx): Promise<ConnectorToolSet> => {
      const attributes = ctx.session.auth.current?.attributes;
      const orgId = attribute(attributes, "orgId");
      const plan = attribute(attributes, "plan") || DEFAULT_PLAN;
      const executionId = attribute(attributes, "executionId");

      if (!orgId) {
        console.log("runtime/connectors: session has no orgId; offering http_request only");
        return buildConnectorTools({ orgId: "", plan, executionId, connections: [] });
      }

      const connections = await listOrgConnections(orgId);
      const tools = buildConnectorTools({ orgId, plan, executionId, connections });
      console.log("runtime/connectors: resolved", {
        orgId,
        plan,
        tools: Object.keys(tools).join(","),
      });

      return tools;
    },
  },
});
