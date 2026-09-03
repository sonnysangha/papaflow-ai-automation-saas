// Server only. Like `lib/vault.ts` and `lib/connections-server.ts` (the `server-only` package is
// not installed in this workspace, so this comment is the guard): this module opens sealed
// credentials and talks to Convex with `ENGINE_SECRET`. Nothing here may be imported from a Client
// Component or any browser bundle.
import { getOrgPlan } from "@/lib/billing";
import {
  getConnectionSealed,
  getWorkflowForRun,
  listWorkflowsByTrigger,
  startRun,
} from "@/lib/engine-client";
import { aadFor, open } from "@/lib/vault";
import type { Trigger } from "@/workflows/types";

/**
 * The two halves every per-connection inbound route needs, factored out of the routes themselves.
 *
 * `/api/events/<provider>/<connectionId>` holds nothing but a connection id out of the URL: no
 * session, no org, no plan. So the shape is always the same — open the connection the URL names
 * (`loadConnection`), prove the delivery with that connection's own secret (`lib/signatures/*`),
 * then start every workflow listening to it (`fanOut`). Only the verification in the middle differs
 * per provider, which is exactly what stays in the route files.
 *
 * Nothing in here returns or logs a secret (CLAUDE.md rule 1): `loadConnection` hands the opened
 * blob to its caller and that caller compares it against a header, and no other value crosses back.
 */

/** A connection as an inbound route sees it: enough to verify a delivery and to start a run. */
export type InboundConnection = {
  orgId: string;
  /** The opened blob — a bot token plus its `secretToken`, a `whsec_…`. Never leaves the route. */
  secret: Record<string, unknown>;
  /** Non-secret facts the route may read and merge into (`chat_ids`, `verified`). */
  meta: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The row's `meta`, when the engine projection carries one. See the note on `loadConnection`. */
function metaOf(row: unknown): Record<string, unknown> {
  return asRecord((row as { meta?: unknown }).meta);
}

/**
 * The connection an inbound URL names, opened — or `null` for every reason a route should answer
 * with the same 404: no such connection, an id that is not even shaped like one, a connection
 * belonging to another provider (a Stripe URL must never accept a Telegram connection's id), a
 * revoked one, and a stored secret this deployment cannot decrypt.
 *
 * One answer for all of them on purpose: an inbound endpoint must not tell a stranger which
 * connection ids exist, or which provider one belongs to.
 *
 * `meta` note: `api.engine.getConnectionSealed` does not project `meta` today, so it reads as `{}`
 * and the routes merge into an empty base (`updateConnectionMeta` merges by key, so nothing else
 * on the row is lost — but a second chat replaces the first). Adding `meta` to that query's
 * projection is the one-line fix; this reads it defensively so the routes need no change when it
 * lands.
 */
export async function loadConnection(
  connectionId: string,
  provider: string,
): Promise<InboundConnection | null> {
  let row: Awaited<ReturnType<typeof getConnectionSealed>>;
  try {
    row = await getConnectionSealed(connectionId);
  } catch (cause) {
    // A deleted connection is a `FatalError` from the engine client; a malformed id is an argument
    // validation error from Convex. Neither is an outage, and both are the same 404.
    console.warn("inbound: connection not available", cause instanceof Error ? cause.message : cause);
    return null;
  }

  if (row.provider !== provider) return null;
  // `needs_reconnect` still accepts deliveries: a failed re-test (Telegram unreachable, say) must
  // not silently drop a provider's retries. Only an explicit revocation stops them.
  if (row.status === "revoked") return null;

  let secret: Record<string, unknown>;
  try {
    secret = open(row.secret, aadFor(row.orgId, connectionId));
  } catch {
    // A wrong KEK, a tampered row, or a create that never sealed. The message is about crypto and
    // has no place in an HTTP answer, so it is swallowed rather than logged with the ciphertext.
    console.error(`inbound: could not open the secret for connection ${connectionId}`);
    return null;
  }

  return { orgId: row.orgId, secret, meta: metaOf(row) };
}

/** One node as the graph stores it — `workflows.graph` is `v.any()`, so it is read, never trusted. */
type StoredNode = { data?: { nodeType?: unknown; inputs?: unknown } | null } | null;

/**
 * The `inputs` of the trigger node that bound this workflow to this connection, out of the stored
 * graph. `listWorkflowsByTrigger` answers "which workflows", not "configured how", so a route that
 * filters on the trigger's own configuration (Stripe's `eventTypes`) has to come back for this.
 */
function triggerInputs(
  graph: unknown,
  triggerType: string,
  connectionId: string,
): Record<string, unknown> | null {
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return null;

  for (const node of nodes as StoredNode[]) {
    const data = node?.data;
    if (!data || data.nodeType !== triggerType) continue;
    const inputs = asRecord(data.inputs);
    if (inputs.connectionId !== connectionId) continue;
    return inputs;
  }
  return null;
}

export type FanOutArgs = {
  orgId: string;
  /** The stored node type, e.g. `telegram.message` or `stripe.event`. */
  triggerType: string;
  connectionId: string;
  /** What every started run receives as its trigger payload. */
  trigger: Trigger;
  /**
   * An optional second pass on the trigger node's own `inputs`. Given, each candidate workflow's
   * graph is re-read and only the ones whose trigger accepts this delivery are started — one extra
   * query per candidate, which is why it is opt-in rather than always on.
   */
  accept?: (inputs: Record<string, unknown>) => boolean;
};

/**
 * Starts one run per workflow listening to this connection, and answers with the execution ids.
 *
 * The plan is resolved once for the org (`getOrgPlan` caches for 60 s anyway) because every
 * workflow here belongs to it — `listWorkflowsByTrigger` is called with the connection's `orgId`,
 * which also makes the lookup an indexed read rather than a table scan.
 *
 * A workflow that refuses to start (the org is out of runs, a graph that no longer parses) is
 * logged and skipped rather than thrown: one broken workflow must not cost a provider the 200 that
 * stops it retrying the delivery into the workflows that *did* start.
 *
 * Unpublished workflows never appear here at all: `listWorkflowsByTrigger` returns `active` rows
 * only. There is nobody to explain a refusal to on this path — the provider gets its 200 either
 * way — so a draft is simply not listening.
 */
export async function fanOut({
  orgId,
  triggerType,
  connectionId,
  trigger,
  accept,
}: FanOutArgs): Promise<string[]> {
  const workflows = await listWorkflowsByTrigger({ orgId, triggerType, connectionId });
  if (workflows.length === 0) return [];

  const planSlug = await getOrgPlan(orgId);
  const started: string[] = [];

  for (const workflow of workflows) {
    try {
      if (accept) {
        const stored = await getWorkflowForRun(workflow._id, workflow.orgId);
        if (!stored) continue;
        const inputs = triggerInputs(stored.graph, triggerType, connectionId);
        if (!inputs || !accept(inputs)) continue;
      }

      const { executionId } = await startRun({
        orgId: workflow.orgId,
        workflowId: workflow._id,
        trigger,
        planSlug,
      });
      started.push(executionId);
    } catch (cause) {
      console.error(`inbound: ${triggerType} could not start ${workflow._id}`, cause);
    }
  }

  return started;
}
