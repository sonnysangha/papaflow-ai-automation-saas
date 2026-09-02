import { defineTool } from "eve/tools";
import { z } from "zod";

import { listOrgConnections } from "../../../lib/connections-engine";

import { requireBuilder } from "../lib/session";

/**
 * The credentials this workspace already has, so the Builder configures a node with a connection
 * that exists instead of asking for one the user added last week.
 *
 * Identity and status only — `listOrgConnections` reads the engine's projection, which never
 * carries a secret, a hint or `meta` (CLAUDE.md rule 1).
 */
export default defineTool({
  description:
    "List the connections this workspace has already added (id, provider, label, status). Use the " +
    "id as `connectionId` when configuring a node. Call request_connection only when the provider " +
    "you need is missing here.",
  inputSchema: z.object({
    provider: z.string().optional().describe("Only list connections for this provider slug."),
  }),
  async execute({ provider }, ctx) {
    const session = await requireBuilder(ctx);
    const connections = await listOrgConnections(session.orgId);

    return {
      connections: connections
        .filter((connection) => !provider || connection.provider === provider)
        .map((connection) => ({
          connectionId: connection.id,
          provider: connection.provider,
          label: connection.label,
          status: connection.status,
        })),
    };
  },
});
