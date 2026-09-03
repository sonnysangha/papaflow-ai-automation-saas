import { defineDynamic } from "eve/tools";

import { DEFAULT_PLAN } from "../../../lib/plans";

import { attribute, resolveConnectorTools } from "../lib/connector-session";
import type { ConnectorToolSet } from "../lib/connector-tools";

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
 * `orgId` comes from the authenticated principal, never from the model or the message. Both the
 * "no organisation" case (`localDev()` during `eve dev`, which yields `principalType: "local-dev"`
 * and no attributes) and a Convex read that fails degrade to `http_request` alone, with a line in
 * the log saying which — `../lib/connector-session.ts` holds that decision, and its unit tests.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx): Promise<ConnectorToolSet> => {
      const attributes = ctx.session.auth.current?.attributes;

      return await resolveConnectorTools({
        orgId: attribute(attributes, "orgId"),
        plan: attribute(attributes, "plan") || DEFAULT_PLAN,
        executionId: attribute(attributes, "executionId"),
      });
    },
  },
});
