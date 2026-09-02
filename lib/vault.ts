// Server only. The `server-only` package is not installed in this workspace, so this comment is the
// guard: nothing in here may be imported from a Client Component or any browser bundle. It reads
// `CREDENTIALS_KEK` (through `lib/envelope.ts`) and returns plaintext credentials.
import { FatalError } from "workflow";

import { getConnectionSealed } from "@/lib/engine-client";
import { aadFor, open } from "@/lib/envelope";

/**
 * The step-side half of the vault (CLAUDE.md rule 2).
 *
 * The AES-256-GCM primitives moved to `lib/envelope.ts` in Phase 10 so the eve Runtime agent can
 * open a credential without importing `lib/engine-client.ts` (which reaches `workflows/run-graph.ts`
 * and its `"use workflow"` bodies). They are re-exported here unchanged, so every existing importer
 * of `@/lib/vault` — the connections routes, the OAuth callbacks, the tests — keeps working.
 */
export { aadFor, open, seal, type Sealed } from "@/lib/envelope";

/** What a step gets back: the opened secret plus the row's non-secret identity. */
export type OpenedConnection = {
  orgId: string;
  provider: string;
  kind: string;
  secret: Record<string, unknown>;
  /** The non-secret half `test()` recorded (verified domains, known chats), for nodes that need it. */
  meta?: Record<string, unknown>;
  status: "active";
};

/**
 * The step-side entry point: read the sealed row, refuse it unless it is usable, and open it.
 *
 * Steps receive a `connectionId`, never a secret — the Workflow SDK records step arguments and
 * return values in the run log (CLAUDE.md rule 1) — so this is where the plaintext appears, and it
 * must not leave the step that called it.
 *
 * A dead connection is a `FatalError`: retrying cannot fix a revoked token, only the user can.
 */
export async function openFresh(connectionId: string): Promise<OpenedConnection> {
  const row = await getConnectionSealed(connectionId);

  if (row.status !== "active") {
    throw new FatalError(
      row.status === "revoked" ? "Connection revoked" : "Connection needs reconnect",
    );
  }

  if (row.expiresAt && row.expiresAt - 60_000 < Date.now()) {
    // Phase 7: proactive refresh — swap the token with the provider, re-seal, patch the row, and
    // use the new secret here. Until then a nearly-expired token is used as-is and the provider's
    // 401 surfaces as a connector error.
  }

  return {
    orgId: row.orgId,
    provider: row.provider,
    kind: row.kind,
    secret: open(row.secret, aadFor(row.orgId, connectionId)),
    meta: (row.meta ?? undefined) as Record<string, unknown> | undefined,
    status: row.status,
  };
}
