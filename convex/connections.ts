import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import {
  connectionCreateArgs,
  connectionKindValidator,
  connectionStatusValidator,
  sealedValidator,
} from "./lib/validators";
import schema from "./schema";

/**
 * Per-organisation connections: the credentials users paste into the app (CLAUDE.md rule 12 — a
 * connection belongs to the org, `createdBy` is informational).
 *
 * The row carries `secret`, an AES-256-GCM envelope, and **nothing in this file that a browser can
 * call may return it** (CLAUDE.md rule 1). Every client-visible query below therefore goes through
 * `project()`, which builds a fresh object out of an explicit field list; `secret` is not on it and
 * the `returns` validators have no such field, so a projection that forgot itself would be refused
 * by the Convex runtime rather than leaking.
 *
 * The sealed blob only ever leaves through `internal.connections.getSealed` → the secret-guarded
 * `api.engine.getConnectionSealed`, which a `"use step"` calls with `ENGINE_SECRET` (rule 5).
 */

/**
 * `meta` is `v.any()` — whatever a connector's `test()` captured — so it is filtered rather than
 * trusted. These are the keys the UI reads today; everything else survives only if its name does
 * not look like a credential.
 */
const SAFE_META_KEYS: ReadonlySet<string> = new Set([
  "models",
  "fetchedAt",
  "chat_ids",
  "team_name",
  "team_id",
  "bot_username",
  "workspace_name",
  "domains",
  "limitRemaining",
]);

/** A connector should never put one of these on `meta`; if one does, the value stops here. */
const SECRET_LOOKING = /secret|token|key|password/i;

/** The client-visible half of `meta`: known-safe keys plus anything not named like a credential. */
function safeMeta(meta: unknown): Record<string, unknown> {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return {};

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (SAFE_META_KEYS.has(key) || !SECRET_LOOKING.test(key)) safe[key] = value;
  }
  return safe;
}

/** What the connections page, the connection picker and node config are allowed to see. */
const connectionSummary = v.object({
  _id: v.id("connections"),
  _creationTime: v.number(),
  provider: v.string(),
  kind: connectionKindValidator,
  label: v.string(),
  hint: v.string(),
  status: connectionStatusValidator,
  scopes: v.array(v.string()),
  expiresAt: v.optional(v.number()),
  requiresFeature: v.optional(v.string()),
  updatedAt: v.number(),
  createdBy: v.string(),
  meta: v.any(),
});

export type ConnectionSummary = typeof connectionSummary.type;

/**
 * The session-less projection: what a connection *is*, with nothing a credential could hide behind.
 * Shared by `listForOrg` here and `api.engine.listOrgConnections`, so the two cannot drift.
 */
export const orgConnection = v.object({
  id: v.id("connections"),
  provider: v.string(),
  kind: connectionKindValidator,
  label: v.string(),
  status: connectionStatusValidator,
  requiresFeature: v.optional(v.string()),
});

/**
 * A connection found by *the provider's* id for it rather than by an organisation — what an
 * inbound delivery has to work with (`POST /api/events/slack` knows a Slack workspace id and
 * nothing else).
 *
 * Even narrower than `orgConnection`: the route has proved nothing at the point it asks, so it
 * gets an id to open, the org that id belongs to, and enough to say which connection answered in a
 * log line. No `meta`, no `hint`, and certainly no secret (CLAUDE.md rule 1).
 */
export const connectionMatch = v.object({
  id: v.id("connections"),
  orgId: v.string(),
  label: v.string(),
  status: connectionStatusValidator,
});

/** Builds the summary field by field. Spreading the document would ship the ciphertext. */
function project(connection: Doc<"connections">): ConnectionSummary {
  return {
    _id: connection._id,
    _creationTime: connection._creationTime,
    provider: connection.provider,
    kind: connection.kind,
    label: connection.label,
    hint: connection.hint,
    status: connection.status,
    scopes: connection.scopes,
    expiresAt: connection.expiresAt,
    requiresFeature: connection.requiresFeature,
    updatedAt: connection.updatedAt,
    createdBy: connection.createdBy,
    meta: safeMeta(connection.meta),
  };
}

/**
 * The row, proving it belongs to `orgId`. Another org's connection is `not_found`, exactly like one
 * that never existed, so ids cannot be probed across organisations.
 */
async function connectionInOrg(
  ctx: QueryCtx,
  id: Id<"connections">,
  orgId: string,
): Promise<Doc<"connections">> {
  const connection = await ctx.db.get(id);
  if (!connection || connection.orgId !== orgId) throw new ConvexError({ code: "not_found" });
  return connection;
}

/** The active organisation's connections, newest first. Never includes the sealed secret. */
export const list = query({
  args: {},
  returns: v.array(connectionSummary),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);

    const connections = await ctx.db
      .query("connections")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();

    return connections.map(project);
  },
});

/** One connection, projected. Throws `not_found` unless it belongs to the active org. */
export const get = query({
  args: { id: v.id("connections") },
  returns: connectionSummary,
  handler: async (ctx, { id }) => {
    const { orgId } = await requireOrg(ctx);
    return project(await connectionInOrg(ctx, id, orgId));
  },
});

/** The org's connections for one provider — what a node's connection picker filters on. */
export const listByProvider = query({
  args: { provider: v.string() },
  returns: v.array(connectionSummary),
  handler: async (ctx, { provider }) => {
    const { orgId } = await requireOrg(ctx);

    const connections = await ctx.db
      .query("connections")
      .withIndex("by_org_provider", (q) => q.eq("orgId", orgId).eq("provider", provider))
      .order("desc")
      .collect();

    return connections.map(project);
  },
});

/**
 * The envelope a row is born with. The AAD that binds a real secret to its row is
 * `${orgId}:${connectionId}`, so nothing can be sealed until the insert has handed back an id:
 * `create` writes this, `/api/connections` seals, `patchSecret` replaces it.
 *
 * The row starts `needs_reconnect` for the same reason — a create that dies in between leaves a
 * connection steps refuse (`openFresh` throws) rather than one that fails deep inside a decrypt.
 */
const PLACEHOLDER_SECRET = { v: 1, keyId: "pending", iv: "", tag: "", ct: "" } as const;

/** Inserts the row and returns the id the caller needs in order to seal the secret. */
export const create = internalMutation({
  args: connectionCreateArgs,
  returns: v.id("connections"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("connections", {
      ...args,
      secret: PLACEHOLDER_SECRET,
      scopes: [],
      status: "needs_reconnect",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Writes the sealed secret and marks the connection usable. Also the landing point for a re-seal
 * (an OAuth token refresh in Phase 7): a secret that was just proven good makes the row active.
 */
export const patchSecret = internalMutation({
  args: { connectionId: v.id("connections"), orgId: v.string(), sealed: sealedValidator },
  returns: v.null(),
  handler: async (ctx, { connectionId, orgId, sealed }) => {
    await connectionInOrg(ctx, connectionId, orgId);

    await ctx.db.patch(connectionId, { secret: sealed, status: "active", updatedAt: Date.now() });
    return null;
  },
});

/** Flips a connection between `active`, `needs_reconnect` and `revoked`. */
export const setStatus = internalMutation({
  args: {
    connectionId: v.id("connections"),
    orgId: v.string(),
    status: connectionStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, orgId, status }) => {
    await connectionInOrg(ctx, connectionId, orgId);

    await ctx.db.patch(connectionId, { status, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Merges into `meta` rather than replacing it: "refresh models" re-runs `test()` and should not
 * drop whatever another call (a channel list, a workspace name) captured earlier.
 *
 * `externalId` rides along because it is a *copy* of one `meta` key (Slack's `team_id`): a re-test
 * that discovers the token now belongs to a different workspace has to move the indexed column
 * with it, or inbound deliveries would keep matching the old one. Omitting it leaves the column
 * exactly as it was — a connector without an `externalIdFrom` never sends one.
 */
export const updateMeta = internalMutation({
  args: {
    connectionId: v.id("connections"),
    orgId: v.string(),
    meta: v.any(),
    externalId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, orgId, meta, externalId }) => {
    const connection = await connectionInOrg(ctx, connectionId, orgId);

    const existing =
      typeof connection.meta === "object" && connection.meta !== null && !Array.isArray(connection.meta)
        ? (connection.meta as Record<string, unknown>)
        : {};
    const incoming =
      typeof meta === "object" && meta !== null && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : {};

    await ctx.db.patch(connectionId, {
      meta: { ...existing, ...incoming },
      ...(externalId === undefined ? {} : { externalId }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Deletes a connection. Workflows referencing it fail at run time with "connection not found". */
export const remove = internalMutation({
  args: { connectionId: v.id("connections"), orgId: v.string() },
  returns: v.null(),
  handler: async (ctx, { connectionId, orgId }) => {
    await connectionInOrg(ctx, connectionId, orgId);

    await ctx.db.delete(connectionId);
    return null;
  },
});

/**
 * The whole row, ciphertext included — the one function that hands the sealed secret out.
 *
 * It is `internalQuery`, so it is unreachable from a browser; the only caller is the secret-guarded
 * `api.engine.getConnectionSealed`, which `lib/vault.ts#openFresh` uses from inside a step. It takes
 * no `orgId` because the step does not know it yet: the org travels back with the row and becomes
 * half of the AAD, so a mismatched pair simply fails to decrypt.
 */
export const getSealed = internalQuery({
  args: { connectionId: v.id("connections") },
  returns: v.union(schema.doc("connections"), v.null()),
  handler: async (ctx, { connectionId }) => await ctx.db.get(connectionId),
});

/**
 * What the eve Runtime agent is allowed to know about an org's connections: which ones exist, what
 * they are and whether they still work. No secret, no `meta`, no `hint` — the agent turns this into
 * a tool list, and a tool descriptor is written into the durable session, so nothing that could
 * become a credential may travel with it (CLAUDE.md rule 1).
 *
 * `internalQuery` again: the only caller is the secret-guarded `api.engine.listOrgConnections`,
 * which `lib/connections-engine.ts` calls with `ENGINE_SECRET` from inside a tool resolver that has
 * no Clerk session of its own.
 */
export const listForOrg = internalQuery({
  args: { orgId: v.string() },
  returns: v.array(orgConnection),
  handler: async (ctx, { orgId }) => {
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();

    return connections.map((connection) => ({
      id: connection._id,
      provider: connection.provider,
      kind: connection.kind,
      label: connection.label,
      status: connection.status,
      requiresFeature: connection.requiresFeature,
    }));
  },
});

/**
 * The connections one provider-side account maps to — the lookup behind the single Slack endpoint.
 *
 * `POST /api/events/slack` is the same URL for every organisation (it goes in an app manifest that
 * is generated long before any connection exists), so the only thing distinguishing one delivery
 * from another is the workspace id inside it. This answers "which rows could have sent this", and
 * the route then proves it with each candidate's own signing secret.
 *
 * More than one row is normal and not an error: two organisations can install the same Slack app
 * into the same workspace, and one organisation can add the same workspace twice. Revoked rows are
 * returned too — the route's `loadConnection` is what refuses them, and it does so identically for
 * both endpoints.
 *
 * `internalQuery`: the caller has no Clerk session, so it arrives through the secret-guarded
 * `api.engine.listConnectionsByExternalId`.
 */
export const byExternalId = internalQuery({
  args: { provider: v.string(), externalId: v.string() },
  returns: v.array(connectionMatch),
  handler: async (ctx, { provider, externalId }) => {
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_provider_external", (q) =>
        q.eq("provider", provider).eq("externalId", externalId),
      )
      .collect();

    return connections.map((connection) => ({
      id: connection._id,
      orgId: connection.orgId,
      label: connection.label,
      status: connection.status,
    }));
  },
});

/**
 * How far back the legacy lookup below will read. Reached only by a deployment with thousands of
 * connections for one provider, and the consequence of hitting it is that a *pre-`externalId`* row
 * stops matching — which is exactly the state it was in before this column existed.
 */
const META_SCAN_LIMIT = 1000;

/**
 * The same question asked of `meta`, for rows written before `externalId` existed.
 *
 * `meta` is `v.any()` and cannot be indexed, so this is a scan — but a scan of one provider's rows,
 * because `by_provider_external` is prefixed with `provider`. It is the fallback path only: the
 * route asks `byExternalId` first and comes here when that finds nothing.
 *
 * Ids only, on purpose. A caller that gets this far is about to open each candidate's sealed secret
 * anyway (`lib/inbound.ts#loadConnection` re-reads the row, checks the provider and the status, and
 * returns the org), so handing back anything else would be a second projection to keep honest.
 */
export const idsByMetaValue = internalQuery({
  args: { provider: v.string(), key: v.string(), value: v.string() },
  returns: v.array(v.id("connections")),
  handler: async (ctx, { provider, key, value }) => {
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_provider_external", (q) => q.eq("provider", provider))
      .take(META_SCAN_LIMIT);

    return connections
      .filter((connection) => {
        const meta = connection.meta;
        if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return false;
        return (meta as Record<string, unknown>)[key] === value;
      })
      .map((connection) => connection._id);
  },
});
