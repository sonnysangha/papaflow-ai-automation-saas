import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { stepMarkArgs, type StepStatus } from "./lib/validators";
import schema from "./schema";

/** Statuses that end a step: they stamp `finishedAt`. Every other status clears it again. */
const TERMINAL: ReadonlySet<StepStatus> = new Set<StepStatus>(["success", "failed", "skipped"]);

/** The one step row for a node in a run, or null. `by_execution_node` makes this a point lookup. */
async function stepFor(
  ctx: QueryCtx,
  executionId: Id<"executions">,
  nodeId: string,
): Promise<Doc<"steps"> | null> {
  return await ctx.db
    .query("steps")
    .withIndex("by_execution_node", (q) => q.eq("executionId", executionId).eq("nodeId", nodeId))
    .unique();
}

/**
 * The execution a step belongs to, proving it belongs to `orgId`. The engine is trusted (it holds
 * ENGINE_SECRET) but not authoritative about ownership, so every write is re-checked here.
 */
async function executionInOrg(ctx: QueryCtx, executionId: Id<"executions">, orgId: string) {
  const execution = await ctx.db.get(executionId);
  if (!execution || execution.orgId !== orgId) throw new ConvexError({ code: "not_found" });
  return execution;
}

/** The stored step, which `runNode` reads to short-circuit a replayed step (CLAUDE.md rule 7). */
export const get = internalQuery({
  args: { executionId: v.id("executions"), nodeId: v.string() },
  returns: v.union(schema.doc("steps"), v.null()),
  handler: async (ctx, { executionId, nodeId }) => await stepFor(ctx, executionId, nodeId),
});

/**
 * Upsert of the one row per execution+node. A step is written at least twice (running → success)
 * and re-runs on retry, so this patches in place: `startedAt` is kept from the first insert and
 * only the fields the caller actually sent are written (a `running` mark never wipes the output of
 * the attempt before it).
 */
export const mark = internalMutation({
  args: stepMarkArgs,
  returns: v.id("steps"),
  handler: async (ctx, args) => {
    const { executionId, orgId, nodeId, nodeType, status, attempt } = args;
    await executionInOrg(ctx, executionId, orgId);

    const now = Date.now();
    const finishedAt = TERMINAL.has(status) ? now : undefined;
    const existing = await stepFor(ctx, executionId, nodeId);

    if (!existing) {
      return await ctx.db.insert("steps", {
        orgId,
        executionId,
        nodeId,
        nodeType,
        status,
        attempt,
        input: args.input,
        output: args.output,
        error: args.error,
        handle: args.handle,
        hookToken: args.hookToken,
        startedAt: now,
        finishedAt,
      });
    }

    // `undefined` in a patch removes the field, so optional values are only included when sent —
    // except `finishedAt`, which is meant to be cleared when a finished step goes back to running.
    const patch: Partial<Doc<"steps">> = { nodeType, status, attempt, finishedAt };
    if (args.input !== undefined) patch.input = args.input;
    if (args.output !== undefined) patch.output = args.output;
    if (args.error !== undefined) patch.error = args.error;
    if (args.handle !== undefined) patch.handle = args.handle;
    if (args.hookToken !== undefined) patch.hookToken = args.hookToken;

    await ctx.db.patch(existing._id, patch);
    return existing._id;
  },
});

/**
 * Marks the nodes a finished run never reached, so the canvas can grey them out. Nodes that already
 * have a row (they ran, failed or are waiting) are left alone, which also makes this idempotent
 * when the step recording it is replayed.
 *
 * `nodeType` is empty because the caller only has the ids of the unvisited nodes; the graph on the
 * execution's workflow is where the UI reads a skipped node's type from.
 */
export const markSkipped = internalMutation({
  args: {
    executionId: v.id("executions"),
    orgId: v.string(),
    nodeIds: v.array(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, { executionId, orgId, nodeIds }) => {
    await executionInOrg(ctx, executionId, orgId);

    const now = Date.now();
    let inserted = 0;
    for (const nodeId of new Set(nodeIds)) {
      if (await stepFor(ctx, executionId, nodeId)) continue;
      await ctx.db.insert("steps", {
        orgId,
        executionId,
        nodeId,
        nodeType: "",
        status: "skipped",
        attempt: 0,
        startedAt: now,
        finishedAt: now,
      });
      inserted++;
    }
    return inserted;
  },
});

/**
 * Every step of one run, oldest first — the query the canvas and the runs drawer subscribe to.
 * Reads are org-scoped through the execution: another org's run is `not_found`, never an empty list.
 */
export const byExecution = query({
  args: { executionId: v.id("executions") },
  returns: v.array(schema.doc("steps")),
  handler: async (ctx, { executionId }) => {
    const { orgId } = await requireOrg(ctx);
    await executionInOrg(ctx, executionId, orgId);

    return await ctx.db
      .query("steps")
      .withIndex("by_execution", (q) => q.eq("executionId", executionId))
      .collect();
  },
});
