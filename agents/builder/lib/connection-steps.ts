import { CONNECTORS } from "../../../connectors/registry";
import { listOrgConnections, openOrgConnection } from "../../../lib/connections-engine";

import { requireBuilderPlan, type BuilderIdentity } from "./session";

/**
 * The two `"use step"` halves of `tools/request_connection.ts`.
 *
 * A durable tool's body is orchestration only — *"In the body, `ctx` has `session`, `callId`,
 * `toolName`, and `abortSignal`. `getSandbox`, `getSkill`, `getToken`, and `requireAuth` throw
 * there; read credentials in a step instead"* (`node_modules/eve/docs/tools/workflows.mdx`) — so
 * the plan check, the connection list and the ownership proof all live here, in functions the
 * Workflow SDK records and replays.
 *
 * **Imported by that one tool and nothing else.** The `"use step"` directive only transforms the
 * functions carrying it, but a step function called outside a run is a mistake waiting to happen,
 * so the plain tools go through `lib/edits.ts` instead.
 *
 * Both take a plain `BuilderIdentity` rather than the tool context: step arguments are recorded by
 * the Workflow SDK and must be serializable, and a `ToolContext` is neither.
 */

export type OfferedConnection = { id: string; label: string; status: string };

export type ConnectionRequestContext = {
  /** The connector's display name ("Notion"), for the prompt the human reads. */
  providerName: string;
  /** Where the user gets the credential, for the widget's help link. */
  docsUrl: string;
  /** Connections this org already has for that provider, newest first. */
  existing: OfferedConnection[];
};

/**
 * Everything the ask needs to be worth reading, and the plan check that must happen before the
 * agent is allowed to ask for anything at all (CLAUDE.md rule 3).
 *
 * Deliberately re-checked here rather than trusted from the turn that started the run: a durable
 * tool can be resumed a day later, and the organisation's plan may have changed in between.
 */
export async function prepareConnectionRequest(
  identity: BuilderIdentity,
  provider: string,
): Promise<ConnectionRequestContext> {
  "use step";

  const session = await requireBuilderPlan(identity);
  const connector = CONNECTORS[provider];
  if (!connector) {
    throw new Error(
      `PapaFlow has no connector called "${provider}". The providers it supports are: ${Object.keys(CONNECTORS).join(", ")}.`,
    );
  }
  if (connector.requiresFeature && !session.features.includes(connector.requiresFeature)) {
    throw new Error(
      `${connector.name} needs the "${connector.requiresFeature}" feature, which this organisation's plan does not include.`,
    );
  }

  const connections = await listOrgConnections(session.orgId);
  return {
    providerName: connector.name,
    docsUrl: connector.docsUrl,
    existing: connections
      .filter((connection) => connection.provider === provider)
      .map((connection) => ({
        id: connection.id,
        label: connection.label,
        status: connection.status,
      })),
  };
}

/**
 * Proves the id the human answered with is a connection this organisation owns, for this provider,
 * and that it works.
 *
 * `openOrgConnection` is the same call the Runtime agent's tools make: it refuses another org's row
 * and a revoked one, and the plaintext it returns is dropped on the next line — the model is told
 * the id and the label and nothing else (CLAUDE.md rule 1).
 */
export async function confirmConnection(
  identity: BuilderIdentity,
  connectionId: string,
  provider: string,
): Promise<{ connectionId: string; provider: string; label: string }> {
  "use step";

  const session = await requireBuilderPlan(identity);
  const connections = await listOrgConnections(session.orgId);
  const connection = connections.find((entry) => entry.id === connectionId);

  if (!connection) {
    throw new Error(
      "That connection id does not belong to this workspace. Ask again, or call list_connections.",
    );
  }
  if (connection.provider !== provider) {
    throw new Error(
      `That connection is a ${connection.provider} connection, not a ${provider} one.`,
    );
  }

  // Proves the credential is readable and active without keeping any of it.
  await openOrgConnection(connection.id, session.orgId);

  return { connectionId: connection.id, provider: connection.provider, label: connection.label };
}
