import { ConvexError, v } from "convex/values";

import { runHistoryDays } from "../lib/plans";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { executionCreateArgs, executionStatusValidator } from "./lib/validators";
import schema from "./schema";

/** How many runs the runs page shows. Older runs are reachable from the workflow's history later. */
const LIST_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The retention window a plan sees on the runs pages: 7 days by default, 30 with `run_history_30d`
 * (`lib/plans.ts`). Nothing is deleted — this is what the *pages* show, so a downgrade hides
 * history rather than destroying it, and an upgrade brings it straight back.
 */
function historyWindow(features: readonly string[]): { days: number; since: number } {
  const days = runHistoryDays(features);
  return { days, since: Date.now() - days * DAY_MS };
}

/**
 * What both runs pages read: the rows inside the window, how wide the window is, and whether the
 * org has runs older than it — which is what turns the "upgrade for 30 days" note on.
 */
const workflowRunsPage = v.object({
  runs: v.array(schema.doc("executions")),
  windowDays: v.number(),
  clipped: v.boolean(),
});

/** Proves the workflow belongs to the caller's org before any of its runs are handed over. */
async function workflowInOrg(
  ctx: QueryCtx,
  workflowId: Id<"workflows">,
  orgId: string,
): Promise<Doc<"workflows">> {
  const workflow = await ctx.db.get(workflowId);
  if (!workflow || workflow.orgId !== orgId) throw new ConvexError({ code: "not_found" });
  return workflow;
}

/**
 * The execution row, written before the durable run is started. `planSlug` is the org's Clerk plan
 * snapshotted at run start (the engine has no session to read `pla` from) and `workflowVersion`
 * pins the graph the run is interpreting, so later edits can't rewrite history.
 *
 * Starts `queued`: `setRunId` promotes it to `running` once the Workflow SDK has accepted the run.
 */
export const create = internalMutation({
  args: executionCreateArgs,
  returns: v.id("executions"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("executions", {
      ...args,
      status: "queued",
      startedAt: Date.now(),
    });
  },
});

/**
 * Records the Workflow SDK run id (the handle `npx workflow web` and `getRun` use) and moves a
 * queued row to `running`. A row that already finished — a run so fast it completed before
 * `start()` returned — keeps its status.
 */
export const setRunId = internalMutation({
  args: { executionId: v.id("executions"), runId: v.string() },
  returns: v.null(),
  handler: async (ctx, { executionId, runId }) => {
    const execution = await ctx.db.get(executionId);
    if (!execution) throw new ConvexError({ code: "not_found" });

    await ctx.db.patch(executionId, {
      runId,
      status: execution.status === "queued" ? "running" : execution.status,
    });
    return null;
  },
});

/**
 * `running` ↔ `waiting`, and nothing else.
 *
 * A run that is asleep on a `sleep()` or suspended on a hook is holding no compute, which is worth
 * saying on the row the runs page reads — "running" for three days is indistinguishable from stuck.
 * `runGraph` sets it from a record step on either side of every suspension.
 *
 * A finished run is never reopened: a late record step from a run that has already been cancelled
 * or failed must not resurrect it, so anything terminal is left exactly as it is. Writing the
 * status it already has is skipped too, so a Loop body that suspends once per item does not cost
 * one write per pass.
 */
export const setStatus = internalMutation({
  args: {
    executionId: v.id("executions"),
    status: v.union(v.literal("running"), v.literal("waiting")),
  },
  returns: v.null(),
  handler: async (ctx, { executionId, status }) => {
    const execution = await ctx.db.get(executionId);
    if (!execution) throw new ConvexError({ code: "not_found" });

    const open = execution.status === "queued" || execution.status === "running" || execution.status === "waiting";
    if (open && execution.status !== status) await ctx.db.patch(executionId, { status });
    return null;
  },
});

/** Terminal state for a run. `error` is the message `runGraph` caught, absent on success. */
export const finish = internalMutation({
  args: {
    executionId: v.id("executions"),
    status: executionStatusValidator,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { executionId, status, error }) => {
    const execution = await ctx.db.get(executionId);
    if (!execution) throw new ConvexError({ code: "not_found" });

    await ctx.db.patch(executionId, { status, finishedAt: Date.now(), ...(error ? { error } : {}) });
    return null;
  },
});

/**
 * The workflow's most recent runs inside the plan's retention window, newest first.
 *
 * `by_workflow_started` is ordered on `startedAt`, so the window is a range on the index: a run
 * outside it is never read at all. One more document — the newest run *before* the cutoff — says
 * whether this plan is hiding history, which is what turns the upgrade note on.
 */
export const listByWorkflow = query({
  args: { workflowId: v.id("workflows") },
  returns: workflowRunsPage,
  handler: async (ctx, { workflowId }) => {
    const { orgId, features } = await requireOrg(ctx);
    await workflowInOrg(ctx, workflowId, orgId);

    const { days, since } = historyWindow(features);

    const runs = await ctx.db
      .query("executions")
      .withIndex("by_workflow_started", (q) =>
        q.eq("workflowId", workflowId).gte("startedAt", since),
      )
      .order("desc")
      .take(LIST_LIMIT);

    const older = await ctx.db
      .query("executions")
      .withIndex("by_workflow_started", (q) =>
        q.eq("workflowId", workflowId).lt("startedAt", since),
      )
      .first();

    return { runs, windowDays: days, clipped: older !== null };
  },
});

/**
 * Every workflow's runs for the whole organisation, newest first and windowed by plan. Powers
 * `/runs`, the header's org-wide history.
 *
 * `by_org_started` is ordered on `startedAt`, so the window really is a range scan here: nothing
 * outside it is read at all, and "are there older runs?" is one document before the cutoff.
 */
export const listByOrg = query({
  args: {},
  returns: v.object({
    runs: v.array(schema.doc("executions")),
    /** Workflow id → name, for the runs table's first column. Deleted workflows are simply absent. */
    workflowNames: v.record(v.string(), v.string()),
    windowDays: v.number(),
    clipped: v.boolean(),
  }),
  handler: async (ctx) => {
    const { orgId, features } = await requireOrg(ctx);
    const { days, since } = historyWindow(features);

    const runs = await ctx.db
      .query("executions")
      .withIndex("by_org_started", (q) => q.eq("orgId", orgId).gte("startedAt", since))
      .order("desc")
      .take(LIST_LIMIT);

    const older = await ctx.db
      .query("executions")
      .withIndex("by_org_started", (q) => q.eq("orgId", orgId).lt("startedAt", since))
      .first();

    // One `get` per distinct workflow on the page, not per row: a busy workflow appears many times.
    const workflowNames: Record<string, string> = {};
    for (const workflowId of new Set(runs.map((execution) => execution.workflowId))) {
      const workflow = await ctx.db.get(workflowId);
      if (workflow && workflow.orgId === orgId) workflowNames[workflowId] = workflow.name;
    }

    return { runs, workflowNames, windowDays: days, clipped: older !== null };
  },
});

/** The newest run, or null before the first one. The canvas subscribes to this for live status. */
export const latestByWorkflow = query({
  args: { workflowId: v.id("workflows") },
  returns: v.union(schema.doc("executions"), v.null()),
  handler: async (ctx, { workflowId }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, workflowId, orgId);

    return await ctx.db
      .query("executions")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .order("desc")
      .first();
  },
});
