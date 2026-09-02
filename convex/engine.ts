import { ConvexError, v } from "convex/values";

import { limitsForPlan } from "../lib/plans";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import {
  connectionCreateArgs,
  connectionKindValidator,
  connectionStatusValidator,
  executionCreateArgs,
  executionStatusValidator,
  sealedValidator,
  stepMarkArgs,
} from "./lib/validators";
import schema from "./schema";
import { graphValidator } from "./workflows";

/**
 * The engine's Convex surface.
 *
 * Steps run on Vercel with no user session, so they cannot present a Clerk token: these functions
 * are public but every one of them proves it is the engine with `ENGINE_SECRET` — an unguessable
 * argument — before delegating to an internal function (CLAUDE.md rule 5; never `setAdminAuth`,
 * which is `@internal`, and internal functions cannot be reached from outside the deployment).
 *
 * Ownership is not taken on trust: `orgId` travels with every call and the internal functions
 * re-check it against the row they are about to touch.
 */
function guard(secret: string): void {
  const expected = process.env.ENGINE_SECRET;
  if (!expected || secret !== expected) throw new ConvexError({ code: "unauthorized" });
}

/**
 * Handlers that `ctx.runQuery`/`ctx.runMutation` their way into `internal.*` are annotated with
 * their return type: `internal` is typed from every module including this one, so inference would
 * be circular ("implicitly has type 'any' because it … is referenced … in its own initializer").
 */
type WorkflowForRun = {
  graph: Doc<"workflows">["graph"];
  version: number;
  name: string;
  webhookSecret: string;
} | null;

/** What a run needs to interpret a workflow. `graph` and `version` are pinned for the whole run. */
const workflowForRunResult = v.union(
  v.object({
    graph: graphValidator,
    version: v.number(),
    name: v.string(),
    webhookSecret: v.string(),
  }),
  v.null(),
);

/**
 * Internal half of `getWorkflowForRun`. A workflow belonging to another org reads as `null` — the
 * caller cannot tell it apart from one that never existed.
 */
export const workflowForRun = internalQuery({
  args: { workflowId: v.id("workflows"), orgId: v.string() },
  returns: workflowForRunResult,
  handler: async (ctx, { workflowId, orgId }) => {
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.orgId !== orgId) return null;

    return {
      graph: workflow.graph,
      version: workflow.version,
      name: workflow.name,
      webhookSecret: workflow.webhookSecret,
    };
  },
});

/** The graph a run is about to execute, or null when the workflow is not this org's. */
export const getWorkflowForRun = query({
  args: { secret: v.string(), workflowId: v.id("workflows"), orgId: v.string() },
  returns: workflowForRunResult,
  handler: async (ctx, { secret, ...args }): Promise<WorkflowForRun> => {
    guard(secret);
    return await ctx.runQuery(internal.engine.workflowForRun, args);
  },
});

/**
 * Opens a run: counts it against the org's monthly quota and writes the execution row. Both happen
 * in one transaction, so a run refused with `run_limit` leaves nothing behind.
 *
 * `planSlug` is the plan the caller read from Clerk at run start (the engine has no session token);
 * `Infinity` in `PLAN_LIMITS` becomes `null` on the wire because JSON cannot carry it.
 */
export const createExecution = mutation({
  args: { secret: v.string(), ...executionCreateArgs },
  returns: v.id("executions"),
  handler: async (ctx, { secret, ...args }): Promise<Id<"executions">> => {
    guard(secret);

    const { runsPerMonth } = limitsForPlan(args.planSlug);
    await ctx.runMutation(internal.usage.incrementRuns, {
      orgId: args.orgId,
      limit: Number.isFinite(runsPerMonth) ? runsPerMonth : null,
    });

    return await ctx.runMutation(internal.executions.create, args);
  },
});

/** Attaches the Workflow SDK run id once `start()` has accepted the run. */
export const setRunId = mutation({
  args: { secret: v.string(), executionId: v.id("executions"), runId: v.string() },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.executions.setRunId, args);
    return null;
  },
});

/** The stored step for a node, so a replayed step can return its output instead of re-running it. */
export const getStep = query({
  args: { secret: v.string(), executionId: v.id("executions"), nodeId: v.string() },
  returns: v.union(schema.doc("steps"), v.null()),
  handler: async (ctx, { secret, ...args }): Promise<Doc<"steps"> | null> => {
    guard(secret);
    return await ctx.runQuery(internal.steps.get, args);
  },
});

/** Upserts the one row per execution+node: `running` first, then the terminal status. */
export const markStep = mutation({
  args: { secret: v.string(), ...stepMarkArgs },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.steps.mark, args);
    return null;
  },
});

/** Writes `skipped` rows for the nodes a finished run never reached (branches not taken). */
export const markSkipped = mutation({
  args: {
    secret: v.string(),
    executionId: v.id("executions"),
    orgId: v.string(),
    nodeIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.steps.markSkipped, args);
    return null;
  },
});

/** Closes a run: status, `finishedAt`, and the error message when it failed. */
export const finishExecution = mutation({
  args: {
    secret: v.string(),
    executionId: v.id("executions"),
    status: executionStatusValidator,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.executions.finish, args);
    return null;
  },
});

/* -------------------------------------------------------------------------------------------------
 * Connections.
 *
 * Credentials are sealed in Node (`lib/vault.ts`) before they reach Convex and opened again inside a
 * `"use step"`, so the whole lifecycle happens outside a user session: the create route, the retest
 * route and `openFresh` all arrive here with `ENGINE_SECRET`. `connections.ts` keeps the internal
 * halves, and the projected queries a browser may call.
 * ---------------------------------------------------------------------------------------------- */

/** The sealed row a step gets back, or null when the connection has been deleted. */
type ConnectionSealed = {
  orgId: string;
  provider: string;
  kind: Doc<"connections">["kind"];
  secret: Doc<"connections">["secret"];
  expiresAt?: number;
  status: Doc<"connections">["status"];
  meta: unknown;
  requiresFeature?: string;
} | null;

/**
 * Deliberately not `schema.doc("connections")`: a step needs the ciphertext, the org that is half
 * of its AAD and enough to refuse a dead connection — not the label, meta or `createdBy`.
 */
const connectionSealedResult = v.union(
  v.object({
    orgId: v.string(),
    provider: v.string(),
    kind: connectionKindValidator,
    secret: sealedValidator,
    expiresAt: v.optional(v.number()),
    status: connectionStatusValidator,
    meta: v.any(),
    requiresFeature: v.optional(v.string()),
  }),
  v.null(),
);

/**
 * Inserts a connection and returns its id. The row is not usable yet: the secret can only be sealed
 * once this id exists (the AAD is `${orgId}:${connectionId}`), so `patchConnectionSecret` follows.
 */
export const createConnection = mutation({
  args: { secret: v.string(), ...connectionCreateArgs },
  returns: v.id("connections"),
  handler: async (ctx, { secret, ...args }): Promise<Id<"connections">> => {
    guard(secret);
    return await ctx.runMutation(internal.connections.create, args);
  },
});

/** Stores the sealed credential and activates the row. `sealed` is ciphertext, never plaintext. */
export const patchConnectionSecret = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id("connections"),
    orgId: v.string(),
    sealed: sealedValidator,
  },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.connections.patchSecret, args);
    return null;
  },
});

/**
 * The sealed credential for one connection — the only way a secret leaves Convex, and the reason
 * this whole file is guarded. `lib/vault.ts#openFresh` is the only caller (CLAUDE.md rule 1).
 */
export const getConnectionSealed = query({
  args: { secret: v.string(), connectionId: v.id("connections") },
  returns: connectionSealedResult,
  handler: async (ctx, { secret, connectionId }): Promise<ConnectionSealed> => {
    guard(secret);

    const row = await ctx.runQuery(internal.connections.getSealed, { connectionId });
    if (!row) return null;

    return {
      orgId: row.orgId,
      provider: row.provider,
      kind: row.kind,
      secret: row.secret,
      expiresAt: row.expiresAt,
      status: row.status,
      meta: row.meta ?? {},
      requiresFeature: row.requiresFeature,
    };
  },
});

/** Merges connector-discovered, non-secret facts into `meta` (the model list, a workspace name). */
export const updateConnectionMeta = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id("connections"),
    orgId: v.string(),
    meta: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.connections.updateMeta, args);
    return null;
  },
});

/** Marks a connection `active`, `needs_reconnect` or `revoked` after a test or a provider 401. */
export const setConnectionStatus = mutation({
  args: {
    secret: v.string(),
    connectionId: v.id("connections"),
    orgId: v.string(),
    status: connectionStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.connections.setStatus, args);
    return null;
  },
});

/** Deletes a connection, once its `orgId` has been re-checked against the row. */
export const removeConnection = mutation({
  args: { secret: v.string(), connectionId: v.id("connections"), orgId: v.string() },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.connections.remove, args);
    return null;
  },
});

/* -------------------------------------------------------------------------------------------------
 * Triggers.
 *
 * Inbound surfaces — the webhook route, the per-connection event routes, the public form page —
 * have no Clerk session and often no org id either: all they hold is what the caller put in the
 * URL. So they arrive here with `ENGINE_SECRET` like the rest of the engine, and these functions
 * hand back only what the route needs to decide whether to start a run.
 *
 * Which workflows a trigger belongs to is a question about the *stored graph*, which is `v.any()`
 * (React Flow owns its shape), so the scans below read nodes defensively rather than trusting it.
 * ---------------------------------------------------------------------------------------------- */

/** Trigger node types graphs store. `nodes/triggers/*` must keep using exactly these strings. */
const WEBHOOK_TRIGGER = "webhook.trigger";
const FORM_TRIGGER = "form.trigger";

/**
 * How many workflows an org-less scan will look at. There is no index for "graph contains a node
 * of this type", so a provider-wide lookup is a table scan; v1 caps it rather than paging, because
 * every real caller (`/api/events/<provider>/<connectionId>`) filters by connection anyway.
 */
const TRIGGER_SCAN_LIMIT = 500;

/** One node as the graph stores it, seen through the only two fields these queries need. */
type StoredNodeShape = { data?: { nodeType?: unknown; inputs?: unknown } | null } | null;

/** True when the graph contains a trigger node of this type, bound to this connection if given. */
function hasTriggerNode(
  workflow: Doc<"workflows">,
  triggerType: string,
  connectionId?: string,
): boolean {
  return (workflow.graph.nodes as StoredNodeShape[]).some((node) => {
    const data = node?.data;
    if (!data || data.nodeType !== triggerType) return false;
    if (connectionId === undefined) return true;

    const inputs = data.inputs;
    if (typeof inputs !== "object" || inputs === null) return false;
    return (inputs as Record<string, unknown>).connectionId === connectionId;
  });
}

/** What a session-less route may learn about a workflow from its id alone. */
const workflowPublicResult = v.union(
  v.object({
    orgId: v.string(),
    webhookSecret: v.string(),
    hasTrigger: v.object({ webhook: v.boolean(), form: v.boolean() }),
  }),
  v.null(),
);

const workflowsByTriggerResult = v.array(
  v.object({ _id: v.id("workflows"), orgId: v.string(), name: v.string() }),
);

/** The form trigger's own `inputs` (title, fields, submitLabel) plus the workflow's name. */
const publicFormResult = v.union(v.object({ name: v.string(), form: v.any() }), v.null());

/** Internal half of `getWorkflowPublic`. */
export const workflowPublic = internalQuery({
  args: { workflowId: v.id("workflows") },
  returns: workflowPublicResult,
  handler: async (ctx, { workflowId }) => {
    const workflow = await ctx.db.get(workflowId);
    if (!workflow) return null;

    return {
      orgId: workflow.orgId,
      webhookSecret: workflow.webhookSecret,
      hasTrigger: {
        webhook: hasTriggerNode(workflow, WEBHOOK_TRIGGER),
        form: hasTriggerNode(workflow, FORM_TRIGGER),
      },
    };
  },
});

/** Internal half of `listWorkflowsByTrigger`. */
export const workflowsByTrigger = internalQuery({
  args: {
    orgId: v.optional(v.string()),
    triggerType: v.string(),
    connectionId: v.optional(v.string()),
  },
  returns: workflowsByTriggerResult,
  handler: async (ctx, { orgId, triggerType, connectionId }) => {
    const workflows =
      orgId === undefined
        ? await ctx.db.query("workflows").take(TRIGGER_SCAN_LIMIT)
        : await ctx.db
            .query("workflows")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();

    return workflows
      .filter((workflow) => hasTriggerNode(workflow, triggerType, connectionId))
      .map((workflow) => ({ _id: workflow._id, orgId: workflow.orgId, name: workflow.name }));
  },
});

/** Internal half of `getPublicForm`. */
export const publicForm = internalQuery({
  args: { workflowId: v.id("workflows") },
  returns: publicFormResult,
  handler: async (ctx, { workflowId }) => {
    const workflow = await ctx.db.get(workflowId);
    if (!workflow) return null;

    const node = (workflow.graph.nodes as StoredNodeShape[]).find(
      (entry) => entry?.data?.nodeType === FORM_TRIGGER,
    );
    if (!node) return null;

    const inputs = node.data?.inputs;
    return {
      name: workflow.name,
      form: typeof inputs === "object" && inputs !== null ? inputs : {},
    };
  },
});

/**
 * The little a webhook route may know before it has proved anything: which org the workflow belongs
 * to (so the run can be started and the plan resolved), the secret to compare its URL segment
 * against, and whether the graph actually has the trigger the route speaks for.
 *
 * The secret is returned rather than compared here on purpose: a Convex mutation cannot do a
 * constant-time compare (no `node:crypto`), so the route does it with `lib/timing.ts#safeEqual`.
 * Nothing else on the workflow — least of all its graph — leaves through this query.
 */
export const getWorkflowPublic = query({
  args: { secret: v.string(), workflowId: v.id("workflows") },
  returns: workflowPublicResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof workflowPublicResult.type> => {
    guard(secret);
    return await ctx.runQuery(internal.engine.workflowPublic, args);
  },
});

/**
 * The workflows an inbound event should start: those whose stored graph has a trigger node of
 * `triggerType`, optionally bound to `connectionId` (`inputs.connectionId`, how Telegram and Stripe
 * routes find "the workflows listening to *this* connection").
 *
 * With `orgId` this is an indexed read; without one it is a capped scan, which is what a route
 * holding nothing but a connection id has to do until connections carry an org id in their URL.
 */
export const listWorkflowsByTrigger = query({
  args: {
    secret: v.string(),
    orgId: v.optional(v.string()),
    triggerType: v.string(),
    connectionId: v.optional(v.string()),
  },
  returns: workflowsByTriggerResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof workflowsByTriggerResult.type> => {
    guard(secret);
    return await ctx.runQuery(internal.engine.workflowsByTrigger, args);
  },
});

/**
 * Claims one inbound delivery. `{ duplicate: true }` means another delivery of the same event has
 * already been recorded and this one must not start a run (providers retry; runs are not free).
 */
export const recordWebhookEvent = mutation({
  args: { secret: v.string(), source: v.string(), eventId: v.string() },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, { secret, ...args }): Promise<{ duplicate: boolean }> => {
    guard(secret);
    return await ctx.runMutation(internal.webhookEvents.record, args);
  },
});

/**
 * The public form page's whole view of a workflow: its name and the form trigger's configuration.
 * No org check — the page is public by design (anyone with the link may submit) — and null when the
 * workflow has no `form.trigger`, which the page renders as a 404.
 */
export const getPublicForm = query({
  args: { secret: v.string(), workflowId: v.id("workflows") },
  returns: publicFormResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof publicFormResult.type> => {
    guard(secret);
    return await ctx.runQuery(internal.engine.publicForm, args);
  },
});
