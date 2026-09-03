import { listOrgConnections } from "../../../lib/connections-engine";
import { engineSecret } from "../../../lib/engine-env";

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
 * eve service had no `CONVEX_URL` — see `lib/engine-env.ts`) was invisible. So a failure now:
 *
 * 1. logs one line naming the reason, with the shared secret scrubbed out of it, and
 * 2. still returns `http_request`, the one tool that needs no credential.
 *
 * A degraded agent that can still call a public API beats a session with no tools at all, and the
 * operator gets a sentence with a variable name in it.
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

/** One log line's worth of an error: no secret, no newlines, no essay. */
function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const secret = engineSecret();
  const masked = secret ? raw.split(secret).join("••••") : raw;
  return masked.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * The tools this session gets. Never throws: every failure degrades to `http_request` with a reason
 * in the log.
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
    console.error(
      `runtime/connectors: could not read connections for ${orgId}; offering http_request only — ${safeMessage(error)}`,
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
