// Server only. Like `lib/vault.ts` (the `server-only` package is not installed in this workspace,
// so this comment is the guard): this module holds plaintext credentials, reads `CREDENTIALS_KEK`
// through the vault and talks to Convex with `ENGINE_SECRET`. Nothing here may be imported from a
// Client Component or any browser bundle.
import { FatalError } from "workflow";

import {
  externalIdOf,
  MODELS_PICKER,
  normalizeSecretInput,
  type ConnectorDef,
  type PickerOption,
} from "@/connectors/define";
import { CONNECTORS } from "@/connectors/registry";
import { isTextGenerationModel } from "@/lib/ai/model-list";
import * as engine from "@/lib/engine-client";
import { featureLabel } from "@/lib/plans";
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
    /** For `upgrade_required`: the feature slug the org is missing, so the UI can name it. */
    readonly feature?: string,
  ) {
    super(error);
    this.name = "ConnectionRequestError";
  }
}

/** The JSON body and status for a thrown failure. Unknown errors never reach the caller verbatim. */
export function connectionErrorResponse(cause: unknown): {
  status: number;
  body: { code: string; error: string; feature?: string };
} {
  if (cause instanceof ConnectionRequestError) {
    return {
      status: cause.status,
      body: {
        code: cause.code,
        error: cause.error,
        ...(cause.feature ? { feature: cause.feature } : {}),
      },
    };
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

/**
 * A stored envelope that will not open: a wrong KEK, a tampered row, or a create that never got as
 * far as sealing. Its own message is about crypto rather than anything a user can act on, so it is
 * never propagated — every caller replaces it with its own verdict.
 */
class SecretUnreadableError extends Error {}

function openStoredSecret(
  row: engine.ConnectionSealed,
  orgId: string,
  connectionId: string,
): Record<string, string> {
  try {
    return asStringSecret(open(row.secret, aadFor(orgId, connectionId)));
  } catch {
    throw new SecretUnreadableError("connection secret could not be opened");
  }
}

const SECRET_UNREADABLE =
  "This connection's stored credential could not be opened. Please add it again.";

/**
 * Runs one server-side call with a connection's plaintext credential in hand.
 *
 * The secret exists only for the duration of `call`, and `call` is expected to return something
 * derived from the *provider's* answer — never the credential itself (CLAUDE.md rule 1).
 *
 * It takes the row rather than an id on purpose: opening the envelope is the one step that
 * materialises key material in this process, and a caller that can answer from the row it already
 * loaded (the model picker) must be able to decide *not* to. The org check therefore belongs to
 * `connectionInOrg`, which every caller does first — a connection this org may not read is a
 * connection that does not exist.
 */
async function withConnectionSecret<T>(
  row: engine.ConnectionSealed,
  orgId: string,
  connectionId: string,
  call: (context: {
    def: ConnectorDef;
    secret: Record<string, string>;
    meta: Record<string, unknown>;
  }) => Promise<T>,
): Promise<T> {
  const def = connectorFor(row.provider);

  let secret: Record<string, string>;
  try {
    secret = openStoredSecret(row, orgId, connectionId);
  } catch {
    throw new ConnectionRequestError(400, "secret_unreadable", SECRET_UNREADABLE);
  }

  const meta = (row.meta ?? {}) as Record<string, unknown>;
  return await call({ def, secret, meta });
}

/**
 * The models a connection captured at connect time, as picker options.
 *
 * Only the strings in `meta.models` are read. A connection's `meta` is written by its connector's
 * `test()` and holds other bookkeeping beside the list (`fetchedAt`, OpenRouter's `limitRemaining`,
 * Telegram's known chats), none of which belongs in a dropdown — and no part of `meta` is ever the
 * credential, which lives sealed in a column of its own (CLAUDE.md rule 1).
 *
 * The id *is* the label: a provider's list endpoint has no display name worth preferring, and what
 * the user picks has to be exactly what the node sends back to the provider. They come back sorted
 * because a provider's own order is arbitrary and OpenRouter alone answers with several hundred
 * entries into a `Select` that has no search box, and filtered because several providers list
 * everything the key can reach — offering `text-embedding-3-small` in the Model field is a run-time
 * 400 nobody could have typed themselves back when it was a text box (`lib/ai/model-list.ts`).
 */
export function modelOptions(meta: Record<string, unknown>): PickerOption[] {
  if (!Array.isArray(meta.models)) return [];

  const seen = new Set<string>();
  const options: PickerOption[] = [];
  for (const entry of meta.models) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id.length === 0 || seen.has(id) || !isTextGenerationModel(id)) continue;
    seen.add(id);
    options.push({ id, label: id });
  }
  // Code-unit order rather than `localeCompare`: model ids are ASCII, and the dropdown should not
  // depend on which ICU the server happens to have.
  return options.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What `POST /api/connections/:id/pick` answers with: the remote objects a config field can offer
 * (Slack channels, Discord guilds, Telegram chats). The credential does the call; only ids and
 * labels come back, which is the whole reason the picker is a server round-trip rather than a
 * client fetch with a token.
 *
 * A connector's options are returned exactly as it built them, extra keys and all: Airtable's and
 * Notion's column pickers describe each column with a `type` and, for an enum-like one, its
 * `choices`, so the panel can offer the right values for a column the user just chose. Nothing is
 * filtered out here because nothing may be put in that is not already a public property of a remote
 * object — a `PickerOption` is a description, never a credential (CLAUDE.md rule 1).
 *
 * `models` is the exception that needs no call at all: every AI connector's `test()` already wrote
 * the provider's list into `meta.models` (CLAUDE.md rule 11), so the AI nodes' model dropdown is
 * answered from the stored row. That is why an AI connector implements no `pick` — and why one
 * that grows a list of its own (voices, say) still gets a model dropdown for free.
 *
 * That path also never opens the sealed credential. The browser triggers this route every time a
 * config panel opens, and a dropdown is no reason to materialise key material in this process —
 * so the envelope is opened only once a connector's `pick` is actually about to be called. The
 * side effect is worth having on its own: a connection whose envelope will not open (a rotated
 * `CREDENTIALS_KEK`, a create that never got as far as sealing) still renders its model list
 * instead of answering `secret_unreadable`.
 */
export async function pickConnectionOptions(args: {
  connectionId: string;
  orgId: string;
  kind: string;
}): Promise<PickerOption[]> {
  const row = await connectionInOrg(args.connectionId, args.orgId);
  const def = connectorFor(row.provider);
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const pick = def.pick;

  if (args.kind === MODELS_PICKER) {
    const stored = modelOptions(meta);
    // The row answers unless it has nothing to say, in which case a connector that grew a list of
    // its own is worth asking — and a connector without one has simply never captured any models.
    if (stored.length > 0 || !pick) return stored;
  }

  if (!pick) {
    throw new ConnectionRequestError(
      400,
      "no_picker",
      `${def.name} connections have nothing to list.`,
    );
  }

  return await withConnectionSecret(row, args.orgId, args.connectionId, async ({ secret }) => {
    try {
      return await pick(args.kind, secret, meta);
    } catch (cause) {
      // A connector's picker throws with the provider's own words; they are safe (`invalid_auth`,
      // `missing_scope`) but they are not the user's language, so only the log gets them.
      console.error("connections: pick failed", { provider: def.provider, kind: args.kind }, cause);
      throw new ConnectionRequestError(
        502,
        "pick_failed",
        `Could not load that list from ${def.name}. Re-test the connection and try again.`,
      );
    }
  });
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
      `${def.name} needs ${featureLabel(def.requiresFeature)}. Upgrade your plan to connect it.`,
      def.requiresFeature,
    );
  }

  // Cleaned once, before the test *and* before the seal: a key tested with its trailing newline
  // trimmed but stored with it intact would pass here and then 401 on every run.
  const normalized = normalizeSecretInput(def, input.secret);

  const result = await def.test(normalized);
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
    // The one `meta` key a fixed inbound URL has to find this row by (Slack's `team_id`), lifted
    // into an indexed column — `meta` itself is `v.any()` and Convex cannot index inside it.
    externalId: externalIdOf(def, result.meta),
    requiresFeature: def.requiresFeature ?? undefined,
  });

  try {
    let secret = normalized;
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
        await engine.updateConnectionMeta({
          connectionId: id,
          orgId: input.orgId,
          meta,
          externalId: externalIdOf(def, meta),
        });
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
    secret = openStoredSecret(row, orgId, connectionId);
  } catch {
    // The error is swallowed on purpose: its message is about crypto, not about anything the
    // user can fix. The row is demoted first, so the connections page shows why.
    await engine.setConnectionStatus({ connectionId, orgId, status: "needs_reconnect" });
    throw new ConnectionRequestError(400, "secret_unreadable", SECRET_UNREADABLE);
  }

  const result = await def.test(secret);
  if (!result.ok) {
    await engine.setConnectionStatus({ connectionId, orgId, status: "needs_reconnect" });
    return { ok: false, status: "needs_reconnect", error: result.error };
  }

  // A re-test is also where a credential can turn out to belong to a *different* account than the
  // one it was added for (a token swapped in place), so the indexed id moves with the meta it
  // was copied from — otherwise inbound deliveries would keep matching the old workspace.
  await engine.updateConnectionMeta({
    connectionId,
    orgId,
    meta: result.meta,
    externalId: externalIdOf(def, result.meta),
  });
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
