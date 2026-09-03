// Server only. Like `lib/vault.ts` and `lib/connections-server.ts` (the `server-only` package is
// not installed in this workspace, so this comment is the guard): this module opens plaintext
// credentials and talks to Convex with `ENGINE_SECRET`. Nothing here may be imported from a Client
// Component or any browser bundle.
import { ConvexHttpClient } from "convex/browser";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { engineEnv } from "@/lib/engine-env";
import { aadFor, open } from "@/lib/envelope";

/**
 * The connection surface for callers that have neither a Clerk session nor the workflow engine:
 * the eve Runtime agent's dynamic tool resolver and its `step.started` model handler.
 *
 * It exists rather than reusing `lib/engine-client.ts` because that module imports
 * `workflows/run-graph.ts` (deliberately — it is how `withWorkflow()` discovers the workflow), and
 * eve compiles an agent by following its imports. Pulling `"use workflow"` bodies into the eve
 * bundle is neither needed nor safe, so this is the same `ENGINE_SECRET` conversation (CLAUDE.md
 * rule 5) with a dependency list of exactly: the Convex HTTP client, the generated API, and the
 * AES-GCM primitives in `lib/envelope.ts`.
 *
 * CLAUDE.md rule 1 still holds end to end: `listOrgConnections` never sees a secret, and the
 * plaintext `openOrgConnection` returns exists only inside the tool call that asked for it.
 */

/** One of the org's connections, as a tool resolver may describe it. Never secret-bearing. */
export type OrgConnection = {
  id: string;
  provider: string;
  kind: string;
  label: string;
  status: "active" | "needs_reconnect" | "revoked";
  requiresFeature?: string;
};

/** What an opened connection gives a tool: the provider slug, the row's `kind` and the plaintext. */
export type OpenedOrgConnection = {
  provider: string;
  kind: string;
  secret: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

/**
 * A fresh client plus the shared secret, per call. Built here rather than at module load for the
 * same reason `lib/engine-client.ts` does it: a client captured at import time would freeze whatever
 * the URL happened to be when the bundle was built.
 *
 * The Runtime agent is its own Vercel service, so the URL comes from `CONVEX_URL` first and the
 * Next-inlined `NEXT_PUBLIC_CONVEX_URL` second (`lib/engine-env.ts`). A missing variable throws
 * `EngineUnavailableError`, which the dynamic tool resolver logs rather than swallows.
 */
function engineConvex(): { client: ConvexHttpClient; secret: string } {
  const { url, secret } = engineEnv("connections-engine");
  return { client: new ConvexHttpClient(url), secret };
}

/** Every connection the organisation owns, newest first. Identity and status only. */
export async function listOrgConnections(orgId: string): Promise<OrgConnection[]> {
  const { client, secret } = engineConvex();
  const rows = await client.query(api.engine.listOrgConnections, { secret, orgId });

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    label: row.label,
    status: row.status,
    requiresFeature: row.requiresFeature,
  }));
}

/**
 * Opens one connection's credential, proving it is this org's first.
 *
 * `orgId` is required rather than taken from the row: the caller is an agent acting for a session,
 * and a connection id it may not read has to look exactly like one that does not exist. The org also
 * happens to be half the AAD, so a mismatched pair would fail the GCM tag check anyway — this just
 * fails it with a sentence a person can act on.
 */
export async function openOrgConnection(
  connectionId: string,
  orgId: string,
): Promise<OpenedOrgConnection> {
  const { client, secret } = engineConvex();
  const row = await client.query(api.engine.getConnectionSealed, {
    secret,
    connectionId: connectionId as Id<"connections">,
  });

  if (!row || row.orgId !== orgId) throw new Error("Connection not found");
  if (row.status !== "active") {
    throw new Error(
      row.status === "revoked"
        ? "That connection was revoked — reconnect it in Settings."
        : "That connection needs reconnecting in Settings.",
    );
  }

  return {
    provider: row.provider,
    kind: row.kind,
    secret: open(row.secret, aadFor(orgId, connectionId)),
    meta: (row.meta ?? undefined) as Record<string, unknown> | undefined,
  };
}
