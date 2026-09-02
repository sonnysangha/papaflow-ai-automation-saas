import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { executionCreateArgs, executionStatusValidator } from "./lib/validators";
import schema from "./schema";

/** How many runs the runs page shows. Older runs are reachable from the workflow's history later. */
const LIST_LIMIT = 50;

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

/** The workflow's most recent runs, newest first. Powers the runs page. */
export const listByWorkflow = query({
  args: { workflowId: v.id("workflows") },
  returns: v.array(schema.doc("executions")),
  handler: async (ctx, { workflowId }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, workflowId, orgId);

    return await ctx.db
      .query("executions")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .order("desc")
      .take(LIST_LIMIT);
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
