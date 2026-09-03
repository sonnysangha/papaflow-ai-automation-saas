import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireEngineSecret, requireOrg } from "./lib/auth";
import { currentPlan } from "./lib/plan";
import schema from "./schema";

/**
 * The canvas graph as it is stored on `workflows.graph`. Nodes and edges stay `v.any()` on purpose:
 * React Flow owns their shape and the node registry validates `data.inputs` at run time. Exported so
 * the engine and the Builder agent can reuse it in later phases.
 */
export const graphValidator = v.object({
  nodes: v.array(v.any()),
  edges: v.array(v.any()),
  viewport: v.optional(v.any()),
  triggerId: v.optional(v.string()),
});

/** `executions.status`, restated so the summary's runs arrive on the client as a narrow union. */
const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("waiting"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

/** What the list page needs — deliberately not the whole document (no graph, no webhook secret). */
const workflowSummary = v.object({
  _id: v.id("workflows"),
  _creationTime: v.number(),
  name: v.string(),
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
  version: v.number(),
  updatedAt: v.number(),
  /**
   * The cron this workflow is currently scheduled on, or null. Only *enabled* schedules are
   * reported: a paused one is not something the list should claim is running, and the canvas is
   * where you go to see it.
   */
  schedule: v.union(v.object({ cron: v.string(), nextAt: v.optional(v.number()) }), v.null()),
  /**
   * The node type of the trigger heading this graph (`"form.trigger"`, `"telegram.message"`, …),
   * or null while the canvas is still empty. The list turns it into a chip; the *type* travels
   * rather than a label so the client owns the wording.
   */
  triggerNodeType: v.union(v.string(), v.null()),
  /** The newest run, or null when this workflow has never run. */
  lastRun: v.union(
    v.object({
      status: runStatus,
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      error: v.optional(v.string()),
    }),
    v.null(),
  ),
  /** The newest runs first, at most eight — the row's activity strip. */
  recentRuns: v.array(
    v.object({
      status: runStatus,
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
    }),
  ),
  /** How many runs started in the last seven days. See `RUN_SCAN` for the cap. */
  runCount7d: v.number(),
});

/** How many runs a row's activity strip shows. */
const RECENT_RUNS = 8;
/**
 * How far back into a workflow's history one list row reads. Both the strip and the seven-day
 * count come out of this single scan, which is what caps the count: a workflow busier than fifty
 * runs a week reports fifty. The list is a glance, and `/w/:id/runs` is where the real number is.
 */
const RUN_SCAN = 50;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Node types that head a graph without saying `.trigger` — the two inbound event triggers. */
const EVENT_TRIGGER_TYPES = new Set(["telegram.message", "stripe.event"]);

/** `data.nodeType` off a stored React Flow node, which the schema keeps as `v.any()`. */
function nodeTypeOf(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const data: unknown = (node as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const nodeType: unknown = (data as { nodeType?: unknown }).nodeType;
  return typeof nodeType === "string" ? nodeType : null;
}

function nodeIdOf(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const id: unknown = (node as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * The trigger this graph is headed by, as a node type: whatever `graph.triggerId` points at, and
 * failing that the first node that looks like a trigger.
 *
 * Spelled out here rather than asked of `nodes/registry`, deliberately: importing the registry into
 * Convex would drag the Workflow SDK in with it. Two node types head a graph without saying so in
 * their name, so they are named above; anything else ending `.trigger` is one by construction.
 */
function triggerNodeTypeOf(graph: Doc<"workflows">["graph"]): string | null {
  const nodes: unknown[] = graph.nodes;

  if (typeof graph.triggerId === "string") {
    const named = nodes.find((node) => nodeIdOf(node) === graph.triggerId);
    const nodeType = named === undefined ? null : nodeTypeOf(named);
    if (nodeType) return nodeType;
  }

  for (const node of nodes) {
    const nodeType = nodeTypeOf(node);
    if (nodeType && (nodeType.endsWith(".trigger") || EVENT_TRIGGER_TYPES.has(nodeType))) {
      return nodeType;
    }
  }
  return null;
}

const WEBHOOK_SECRET_LENGTH = 32;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * 32 base64url characters of entropy for the workflow's webhook URL (Phase 5). The Convex runtime
 * provides Web Crypto; the `Math.random` branch only exists so a missing `crypto` can never block a
 * create, and would need replacing before webhooks ship if it ever fires.
 */
function randomWebhookSecret(): string {
  try {
    const bytes = new Uint8Array(WEBHOOK_SECRET_LENGTH);
    crypto.getRandomValues(bytes);
    let secret = "";
    for (const byte of bytes) secret += BASE64URL[byte & 63];
    return secret;
  } catch {
    console.warn("crypto.getRandomValues unavailable; falling back to Math.random");
    let secret = "";
    while (secret.length < WEBHOOK_SECRET_LENGTH) {
      secret += Math.floor(Math.random() * 16).toString(16);
    }
    return secret.slice(0, WEBHOOK_SECRET_LENGTH);
  }
}

/**
 * Loads a workflow and proves it belongs to the caller's organisation. A row from another org is
 * indistinguishable from one that never existed, so this never leaks ids across organisations.
 */
async function workflowInOrg(
  ctx: QueryCtx,
  id: Id<"workflows">,
  orgId: string,
): Promise<Doc<"workflows">> {
  const workflow = await ctx.db.get(id);
  if (!workflow || workflow.orgId !== orgId) throw new ConvexError({ code: "not_found" });
  return workflow;
}

/** The active organisation's workflows, newest first. */
export const list = query({
  args: {},
  returns: v.array(workflowSummary),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);

    const workflows = await ctx.db
      .query("workflows")
      .withIndex("by_org_updated", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();

    // One indexed read for the whole org rather than one per row: a workspace has few schedules,
    // and the list must not turn into an N+1 as it grows.
    const schedules = await ctx.db
      .query("schedules")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const byWorkflow = new Map(
      schedules
        .filter((schedule) => schedule.enabled)
        .map((schedule) => [
          schedule.workflowId,
          { cron: schedule.cron, nextAt: schedule.nextAt },
        ]),
    );

    // Runs are per workflow — the index is keyed on one — so this is the one fan-out the list does,
    // bounded by `RUN_SCAN` rows each and issued in parallel rather than one row at a time.
    const since = Date.now() - SEVEN_DAYS_MS;

    return await Promise.all(
      workflows.map(async (workflow) => {
        const runs = await ctx.db
          .query("executions")
          .withIndex("by_workflow_started", (q) => q.eq("workflowId", workflow._id))
          .order("desc")
          .take(RUN_SCAN);

        const [newest] = runs;

        return {
          _id: workflow._id,
          _creationTime: workflow._creationTime,
          name: workflow.name,
          status: workflow.status,
          version: workflow.version,
          updatedAt: workflow.updatedAt,
          schedule: byWorkflow.get(workflow._id) ?? null,
          triggerNodeType: triggerNodeTypeOf(workflow.graph),
          lastRun: newest
            ? {
                status: newest.status,
                startedAt: newest.startedAt,
                finishedAt: newest.finishedAt,
                error: newest.error,
              }
            : null,
          recentRuns: runs.slice(0, RECENT_RUNS).map((run) => ({
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          })),
          runCount7d: runs.filter((run) => run.startedAt >= since).length,
        };
      }),
    );
  },
});

/** One workflow, including its graph. Throws `not_found` unless it belongs to the active org. */
export const get = query({
  args: { id: v.id("workflows") },
  returns: schema.doc("workflows"),
  handler: async (ctx, { id }) => {
    const { orgId } = await requireOrg(ctx);
    return await workflowInOrg(ctx, id, orgId);
  },
});

/**
 * Creates a draft. Refuses with `plan_limit` when the org is at its plan's workflow cap.
 *
 * `graph` is optional and starts the workflow from a starter template (`lib/templates.ts`) instead
 * of an empty canvas. It goes through the same `graphValidator` as `saveGraph`, so a template is
 * indistinguishable from a graph somebody drew — there is no template mode to get out of, and the
 * canvas' next save carries on from version 1 exactly as it would have.
 */
export const create = mutation({
  args: { name: v.string(), graph: v.optional(graphValidator) },
  returns: v.id("workflows"),
  handler: async (ctx, { name, graph }) => {
    const { userId, orgId } = await requireOrg(ctx);
    const { limits } = await currentPlan(ctx);

    // `Infinity` means unlimited; otherwise take at most `limit` rows just to count them.
    const limit = limits.workflows;
    if (Number.isFinite(limit)) {
      const existing = await ctx.db
        .query("workflows")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .take(limit);
      if (existing.length >= limit) throw new ConvexError({ code: "plan_limit", limit });
    }

    return await ctx.db.insert("workflows", {
      orgId,
      createdBy: userId,
      name: name.trim() || "Untitled workflow",
      graph: graph ?? { nodes: [], edges: [] },
      version: 1,
      status: "draft",
      webhookSecret: randomWebhookSecret(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Replaces the graph with optimistic concurrency: the caller sends the version it last saw and gets
 * the new one back. A mismatch throws `version_conflict` with the version the caller should adopt.
 */
export const saveGraph = mutation({
  args: {
    id: v.id("workflows"),
    graph: graphValidator,
    expectedVersion: v.number(),
  },
  returns: v.object({ version: v.number() }),
  handler: async (ctx, { id, graph, expectedVersion }) => {
    const { userId, orgId } = await requireOrg(ctx);
    const workflow = await workflowInOrg(ctx, id, orgId);

    if (workflow.version !== expectedVersion) {
      throw new ConvexError({ code: "version_conflict", version: workflow.version });
    }

    const version = workflow.version + 1;
    await ctx.db.patch(id, {
      graph,
      version,
      lastEditSource: "canvas",
      lastEditedBy: userId,
      updatedAt: Date.now(),
    });

    return { version };
  },
});

/**
 * Publishes a workflow, or takes it back off the air.
 *
 * This is the switch every trigger reads: a webhook delivery, a form submission, an inbound chat
 * message and a scheduled tick all refuse unless `status` is `active`. Manual "Run" from the canvas
 * deliberately does not — testing a workflow is how you decide it is ready to publish.
 *
 * `draft` is not a destination: it is where `create` starts a workflow and the one state it can
 * never be put back into, so "unpublish" means `paused` and the list can say which workflows were
 * published once. Like `rename`, this is not a graph edit and does not bump `version`.
 *
 * **This mutation moves the switch and nothing else.** The canvas publishes through the
 * `publishWorkflow` server action instead, because a Schedule trigger's "on" is two writes — this
 * status *and* a durable Convex job armed for the next occurrence — and only the server can make
 * both. Anything that flips the status on its own (the Builder agent, an older client) therefore
 * risks leaving a schedule enabled on an unpublished workflow; that is safe by construction rather
 * than by luck, because `app/api/engine/schedule-tick/route.ts` refuses a tick whose workflow is not
 * `active` and the schedule simply resumes firing once it is published again.
 */
export const setStatus = mutation({
  args: {
    id: v.id("workflows"),
    status: v.union(v.literal("active"), v.literal("paused")),
  },
  returns: v.null(),
  handler: async (ctx, { id, status }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, id, orgId);

    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    return null;
  },
});

/**
 * The same switch, for a caller with no Clerk session: the `publishWorkflow` server action.
 *
 * It is guarded by `ENGINE_SECRET` rather than by a session (CLAUDE.md rule 5) for the same reason
 * `runWorkflow` and `POST /api/schedules` are — the action already holds an engine client to write
 * the schedule row, and publishing has to be one decision rather than two half-authenticated ones.
 * `orgId` comes from Clerk on the caller's side and is re-checked here against the row.
 */
export const setStatusFromEngine = mutation({
  args: {
    secret: v.string(),
    id: v.id("workflows"),
    orgId: v.string(),
    status: v.union(v.literal("active"), v.literal("paused")),
  },
  returns: v.null(),
  handler: async (ctx, { secret, id, orgId, status }) => {
    requireEngineSecret(secret);
    await workflowInOrg(ctx, id, orgId);

    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    return null;
  },
});

/** Renames a workflow. Does not touch the graph version — only `saveGraph` moves that. */
export const rename = mutation({
  args: { id: v.id("workflows"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, id, orgId);

    await ctx.db.patch(id, { name: name.trim() || "Untitled workflow", updatedAt: Date.now() });
    return null;
  },
});

/**
 * Deletes a workflow. Executions and steps are left alone; Phase 2 decides their retention.
 *
 * The schedule row goes with it, because it is configuration rather than history — and unlike the
 * old Workflow SDK design, a mutation *can* reach Convex's own scheduler, so the alarm clock does
 * not outlive the row it points at: `internal.schedules.removeForWorkflow` cancels the pending job
 * before it deletes the row, rather than leaving a Convex job to wake up, find nothing, and return.
 */
export const remove = mutation({
  args: { id: v.id("workflows") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, id, orgId);

    await ctx.runMutation(internal.schedules.removeForWorkflow, { workflowId: id });
    await ctx.db.delete(id);
    return null;
  },
});

/**
 * Issues a new webhook secret, which invalidates every URL handed out so far
 * (`/api/hooks/<id>/<secret>`). The canvas' "Rotate secret" button is the only caller; the new
 * secret reaches it through the live `workflows.get` subscription rather than this return value,
 * so a second tab's URL updates at the same moment.
 *
 * Deliberately not a version bump: the graph did not change, so no canvas has a conflict to
 * resolve — only `updatedAt` moves.
 */
export const rotateWebhookSecret = mutation({
  args: { id: v.id("workflows") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, id, orgId);

    await ctx.db.patch(id, { webhookSecret: randomWebhookSecret(), updatedAt: Date.now() });
    return null;
  },
});
