// Server only. Like `lib/vault.ts` (the `server-only` package is not installed in this workspace,
// so this comment is the guard): this module holds plaintext credentials, reads `CREDENTIALS_KEK`
// through the vault and talks to Convex with `ENGINE_SECRET`. Nothing here may be imported from a
// Client Component or any browser bundle.
import { FatalError } from "workflow";

import type { ConnectorDef } from "@/connectors/define";
import { CONNECTORS } from "@/connectors/registry";
import * as engine from "@/lib/engine-client";
import { aadFor, open, seal } from "@/lib/vault";

/**
 * What `/api/connections` actually does, kept out of the route files so the two routes, the OAuth
 * callbacks (Phase 7) and the Builder's `request_connection` tool (Phase 12) share one code path.
 *
 * The shape of a create is fixed by the AAD: the secret is bound to `${orgId}:${connectionId}`, so
 * the row has to exist before the ciphertext can. Hence test → insert → seal → patch, with the row
 * only becoming `active` on that last step.
 *
 * Nothing in here returns, logs or echoes a secret — the four-character `hint` a connector reports
 * is the only part of a credential that ever leaves (CLAUDE.md rule 1).
 */

/** Clerk's `has`, narrowed to the one question this module asks of it. */
export type HasFeature = (params: { feature: string }) => boolean;

/** An HTTP-shaped failure. The routes turn it into `{ code, error }` with this status. */
export class ConnectionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly error: string,
  ) {
    super(error);
    this.name = "ConnectionRequestError";
  }
}

/** The JSON body and status for a thrown failure. Unknown errors never reach the caller verbatim. */
export function connectionErrorResponse(cause: unknown): {
  status: number;
  body: { code: string; error: string };
} {
  if (cause instanceof ConnectionRequestError) {
    return { status: cause.status, body: { code: cause.code, error: cause.error } };
  }

  // The request bodies here carry credentials, so only the error is logged, never the input.
  console.error("connections: unexpected failure", cause);
  return {
    status: 500,
    body: { code: "internal_error", error: "Something went wrong. Please try again." },
  };
}

function connectorFor(provider: string): ConnectorDef {
  const def = CONNECTORS[provider];
  if (!def) {
    throw new ConnectionRequestError(400, "unknown_provider", `Unknown provider: ${provider}`);
  }
  return def;
}

/** Where a connector's `afterCreate` should point a provider's callbacks. */
function appOrigin(): string {
  return process.env.APP_ORIGIN ?? "http://localhost:3000";
}

/**
 * Loads the sealed row and proves it is this org's. Anything that stops the row from arriving —
 * it was deleted, the id in the URL is not an id at all — is a `not_found`, so a caller can never
 * tell another org's connection apart from one that does not exist.
 */
async function connectionInOrg(
  connectionId: string,
  orgId: string,
): Promise<engine.ConnectionSealed> {
  let row: engine.ConnectionSealed;
  try {
    row = await engine.getConnectionSealed(connectionId);
  } catch (cause) {
    if (!(cause instanceof FatalError)) console.error("connections: load failed", cause);
    throw new ConnectionRequestError(404, "not_found", "Connection not found");
  }

  if (row.orgId !== orgId) throw new ConnectionRequestError(404, "not_found", "Connection not found");
  return row;
}

/** Connector forms are string fields; anything else on a stored blob is not a form value. */
function asStringSecret(secret: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(secret)) {
    if (typeof value === "string") fields[name] = value;
  }
  return fields;
}

/** How many models the last discovery captured — the number the connections list shows. */
function modelCount(meta: Record<string, unknown>): number {
  return Array.isArray(meta.models) ? meta.models.length : 0;
}

export type CreateConnectionFromInput = {
  orgId: string;
  userId: string;
  provider: string;
  label?: string;
  secret: Record<string, string>;
  has: HasFeature;
};

/**
 * Tests a pasted credential, stores it sealed, and returns only the row's id and display label.
 *
 * The feature gate is repeated here even though the UI dims unavailable connectors: a UI check is
 * decoration (CLAUDE.md rule 3), and this is the layer a `curl` has to get past.
 */
export async function createConnectionFromInput(
  input: CreateConnectionFromInput,
): Promise<{ id: string; label: string }> {
  const def = connectorFor(input.provider);

  if (def.requiresFeature && !input.has({ feature: `org:${def.requiresFeature}` })) {
    throw new ConnectionRequestError(
      403,
      "upgrade_required",
      `${def.name} needs the ${def.requiresFeature} feature. Upgrade your plan to connect it.`,
    );
  }

  const result = await def.test(input.secret);
  if (!result.ok) throw new ConnectionRequestError(400, "test_failed", result.error);

  const label = input.label?.trim() || result.label;
  const id = await engine.createConnection({
    orgId: input.orgId,
    createdBy: input.userId,
    provider: def.provider,
    kind: def.kind,
    label,
    hint: result.hint,
    meta: result.meta,
    requiresFeature: def.requiresFeature ?? undefined,
  });

  try {
    let secret = input.secret;
    let meta = result.meta;

    // Some connectors can only finish once the row has an id: registering a webhook whose URL
    // contains it, say, which hands back a signing secret to store alongside the original.
    if (def.afterCreate) {
      const extra = await def.afterCreate({
        connectionId: id,
        secret,
        appOrigin: appOrigin(),
      });
      if (extra.secret) secret = { ...secret, ...extra.secret };
      if (extra.meta) {
        meta = { ...meta, ...extra.meta };
        await engine.updateConnectionMeta({ connectionId: id, orgId: input.orgId, meta });
      }
    }

    await engine.patchConnectionSecret({
      connectionId: id,
      orgId: input.orgId,
      sealed: seal(secret, aadFor(input.orgId, id)),
    });
  } catch (cause) {
    // The row exists but holds the placeholder envelope, so it could never run. Better no
    // connection than one that is permanently broken and looks real in the list.
    await engine
      .removeConnection({ connectionId: id, orgId: input.orgId })
      .catch((error: unknown) => console.error("connections: rollback failed", error));
    throw cause;
  }

  return { id, label };
}

export type ConnectionTestOutcome =
  | { ok: true; status: "active"; label: string; hint: string; models: number }
  | { ok: false; status: "needs_reconnect"; error: string };

/**
 * Opens a stored credential, re-runs the connector's `test()` and writes back what it learned.
 *
 * The plaintext exists only inside this function. A failure is not an HTTP error: the connection
 * was updated (it is now `needs_reconnect`), and the caller wants to render that verdict.
 */
async function testStoredConnection(
  connectionId: string,
  orgId: string,
): Promise<ConnectionTestOutcome> {
  const row = await connectionInOrg(connectionId, orgId);
  const def = connectorFor(row.provider);

  let secret: Record<string, string>;
  try {
    secret = asStringSecret(open(row.secret, aadFor(orgId, connectionId)));
  } catch {
    // A wrong KEK, a tampered row, or a create that never got as far as sealing. The error is
    // swallowed on purpose: its message is about crypto, not about anything the user can fix.
    await engine.setConnectionStatus({ connectionId, orgId, status: "needs_reconnect" });
    throw new ConnectionRequestError(
      400,
      "secret_unreadable",
      "This connection's stored credential could not be opened. Please add it again.",
    );
  }

  const result = await def.test(secret);
  if (!result.ok) {
    await engine.setConnectionStatus({ connectionId, orgId, status: "needs_reconnect" });
    return { ok: false, status: "needs_reconnect", error: result.error };
  }

  await engine.updateConnectionMeta({ connectionId, orgId, meta: result.meta });
  await engine.setConnectionStatus({ connectionId, orgId, status: "active" });
  return {
    ok: true,
    status: "active",
    label: result.label,
    hint: result.hint,
    models: modelCount(result.meta),
  };
}

/** "Re-test": does the stored credential still work? Updates `status` either way. */
export async function retestConnection(args: {
  connectionId: string;
  orgId: string;
}): Promise<ConnectionTestOutcome> {
  return await testStoredConnection(args.connectionId, args.orgId);
}

/**
 * "Refresh models": re-reads the provider's list endpoint into `meta.models`, so a picker offers
 * models released since the connection was added (CLAUDE.md rule 11 — nothing is hardcoded).
 *
 * It is the same call as a re-test because `test()` is the only method every connector implements,
 * and a discovery that fails is exactly the evidence a re-test looks for.
 */
export async function refreshConnectionMeta(args: {
  connectionId: string;
  orgId: string;
}): Promise<ConnectionTestOutcome> {
  return await testStoredConnection(args.connectionId, args.orgId);
}

/** Deletes one of the org's connections. `not_found` covers both "gone" and "not yours". */
export async function removeConnection(args: {
  connectionId: string;
  orgId: string;
}): Promise<void> {
  await connectionInOrg(args.connectionId, args.orgId);
  await engine.removeConnection({ connectionId: args.connectionId, orgId: args.orgId });
}
