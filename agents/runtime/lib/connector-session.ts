import { listOrgConnections } from "../../../lib/connections-engine";
import { safeErrorMessage } from "../../../lib/engine-env";

import {
  buildConnectorTools,
  type ConnectorToolSet,
  type ToolConnection,
} from "./connector-tools";

/**
 * Turning one session's auth attributes into the Runtime agent's tool list.
 *
 * `tools/connectors.ts` is the `defineDynamic` wrapper and nothing else; this is the part with a
 * decision in it, and the part a unit test can drive without eve's runtime.
 *
 * The decision that matters is what happens when the connection read fails. It used to throw out of
 * the `session.started` handler, which resolves no tools and says nothing: in production the agent
 * looked exactly like an organisation that had never connected anything, and the actual cause (the
 * eve service had no `CONVEX_URL` — see `lib/engine-env.ts`) was invisible. So every failure now
 * logs one line naming the reason, with the shared secret scrubbed out of it — and then the two
 * kinds of session part company:
 *
 * - **A person chatting** (a browser session: `orgId` and `plan`, no `executionId`) still gets
 *   `http_request`, the one tool that needs no credential. A degraded agent that can call a public
 *   API beats a session with no tools at all, and the human can see what it is missing.
 * - **A run** (the Agent node's step mints a token carrying `executionId`) fails instead. Degrading
 *   there would record a successful run whose agent silently had none of the org's connectors, with
 *   nothing in the `steps` or `executions` tables to say so; the throw keeps the step's retries —
 *   which is the right answer for the transient half of these failures — and keeps the run's status
 *   honest.
 */

/** Auth attributes are `string | readonly string[]`; every claim these agents read is a string. */
export function attribute(
  attributes: Readonly<Record<string, string | readonly string[]>> | undefined,
  name: string,
): string {
  const value = attributes?.[name];
  return typeof value === "string" ? value : "";
}

export type ConnectorSession = {
  /** The organisation on the authenticated principal — never from the model or the message. */
  orgId: string;
  plan: string;
  executionId: string;
};

/** How connections are read. Injectable so the degraded path is testable without a deployment. */
export type ListConnections = (orgId: string) => Promise<readonly ToolConnection[]>;

/**
 * The tools this session gets.
 *
 * Throws only when a session started for an execution cannot read its connections — see the note
 * above. An interactive session always resolves, with a reason in the log when it is degraded.
 */
export async function resolveConnectorTools(
  session: ConnectorSession,
  list: ListConnections = listOrgConnections,
): Promise<ConnectorToolSet> {
  const { orgId, plan, executionId } = session;

  if (!orgId) {
    // `localDev()` under `eve dev` yields `principalType: "local-dev"` and no attributes at all.
    console.log("runtime/connectors: session has no orgId; offering http_request only");
    return buildConnectorTools({ orgId: "", plan, executionId, connections: [] });
  }

  let connections: readonly ToolConnection[];
  try {
    connections = await list(orgId);
  } catch (error) {
    const reason = safeErrorMessage(error);
    if (executionId) {
      console.error(
        `runtime/connectors: could not read connections for ${orgId} on execution ${executionId}; failing the step — ${reason}`,
      );
      // Rethrown carrying the *scrubbed* sentence, not the original: this one travels back to the
      // Agent node's step, which records it on the `steps` row the canvas reads (CLAUDE.md rule 1).
      // `name` is kept so `isEngineUnavailable` still recognises what this was.
      const failure = new Error(reason, { cause: error });
      if (error instanceof Error) failure.name = error.name;
      throw failure;
    }
    console.error(
      `runtime/connectors: could not read connections for ${orgId}; offering http_request only — ${reason}`,
    );
    return buildConnectorTools({ orgId, plan, executionId, connections: [] });
  }

  const tools = buildConnectorTools({ orgId, plan, executionId, connections });
  console.log("runtime/connectors: resolved", {
    orgId,
    plan,
    tools: Object.keys(tools).join(","),
  });

  return tools;
}
