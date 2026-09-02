import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { stepMarkArgs, stepStatusValidator, type StepStatus } from "./lib/validators";
import schema from "./schema";

/** Statuses that end a step: they stamp `finishedAt`. Every other status clears it again. */
const TERMINAL: ReadonlySet<StepStatus> = new Set<StepStatus>(["success", "failed", "skipped"]);

/**
 * The one step row for a node in a run, or null. `by_execution_node` makes this a point lookup.
 *
 * A node runs once, so "the row for this node" is normally unambiguous — except on a Loop body,
 * where the same node runs once per item. `iteration` is therefore part of the key rather than a
 * detail on the row: pass 2 looks up pass 2, and a node outside a loop looks up the row whose
 * `iteration` is absent (`undefined` is a value the index stores and matches like any other).
 */
async function stepFor(
  ctx: QueryCtx,
  executionId: Id<"executions">,
  nodeId: string,
  iteration?: number,
): Promise<Doc<"steps"> | null> {
  return await ctx.db
    .query("steps")
    .withIndex("by_execution_node", (q) =>
      q.eq("executionId", executionId).eq("nodeId", nodeId).eq("iteration", iteration),
    )
    .unique();
}

/** Whether this node has any row in this run at all, whichever pass wrote it. */
async function anyStepFor(
  ctx: QueryCtx,
  executionId: Id<"executions">,
  nodeId: string,
): Promise<Doc<"steps"> | null> {
  return await ctx.db
    .query("steps")
    .withIndex("by_execution_node", (q) => q.eq("executionId", executionId).eq("nodeId", nodeId))
    .first();
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
  args: {
    executionId: v.id("executions"),
    nodeId: v.string(),
    iteration: v.optional(v.number()),
  },
  returns: v.union(schema.doc("steps"), v.null()),
  handler: async (ctx, { executionId, nodeId, iteration }) =>
    await stepFor(ctx, executionId, nodeId, iteration),
});

/**
 * A step that is (or was) suspended on a hook, found by the token alone — the only thing a resume
 * route holds, since the token comes out of its URL.
 *
 * Deliberately not the whole document: a resume route has proved nothing but possession of the
 * token, and a step's `input`/`output` is node data. It gets the ids it needs to decide whether to
 * resume, and nothing else (CLAUDE.md rule 1).
 */
export const byHookToken = internalQuery({
  args: { hookToken: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("steps"),
      executionId: v.id("executions"),
      orgId: v.string(),
      nodeId: v.string(),
      nodeType: v.string(),
      status: stepStatusValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, { hookToken }) => {
    const step = await ctx.db
      .query("steps")
      .withIndex("by_hookToken", (q) => q.eq("hookToken", hookToken))
      .unique();
    if (!step) return null;

    return {
      _id: step._id,
      executionId: step.executionId,
      orgId: step.orgId,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      status: step.status,
    };
  },
});

/**
 * The same projection, found by the row's own id.
 *
 * Approval buttons carry `approve:<stepRowId>` rather than the hook token: Telegram caps
 * `callback_data` at 64 bytes and a token is `${executionId}:${nodeId}[:${iteration}]`, which is
 * neither short nor bounded. A Convex id is 32 characters and always will be, so the button carries
 * the id and the resume route turns it back into the token here — `hookToken` when the suspending
 * mark stored one, and `hookTokenFor(executionId, nodeId, iteration)` recomputes the same string
 * from the three ids beside it either way.
 *
 * Ids and status only, exactly like `byHookToken`: the caller has proved a provider signature, not
 * a right to read this run's data (CLAUDE.md rule 1).
 */
export const byId = internalQuery({
  args: { stepId: v.id("steps") },
  returns: v.union(
    v.object({
      _id: v.id("steps"),
      executionId: v.id("executions"),
      orgId: v.string(),
      nodeId: v.string(),
      nodeType: v.string(),
      status: stepStatusValidator,
      iteration: v.optional(v.number()),
      hookToken: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { stepId }) => {
    const step = await ctx.db.get(stepId);
    if (!step) return null;

    return {
      _id: step._id,
      executionId: step.executionId,
      orgId: step.orgId,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      status: step.status,
      iteration: step.iteration,
      hookToken: step.hookToken,
    };
  },
});

/**
 * Upsert of the one row per execution+node+iteration. A step is written at least twice
 * (running → success) and re-runs on retry, so this patches in place: `startedAt` is kept from the
 * first insert and only the fields the caller actually sent are written (a `running` mark never
 * wipes the output of the attempt before it). A Loop body node sends an `iteration`, and each pass
 * therefore gets a row of its own rather than overwriting the last one.
 */
export const mark = internalMutation({
  args: stepMarkArgs,
  returns: v.id("steps"),
  handler: async (ctx, args) => {
    const { executionId, orgId, nodeId, nodeType, status, attempt } = args;
    await executionInOrg(ctx, executionId, orgId);

    const now = Date.now();
    const finishedAt = TERMINAL.has(status) ? now : undefined;
    const existing = await stepFor(ctx, executionId, nodeId, args.iteration);

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
        warnings: args.warnings,
        handle: args.handle,
        hookToken: args.hookToken,
        iteration: args.iteration,
        startedAt: now,
        finishedAt,
      });
    }

    // `undefined` in a patch removes the field, so optional values are only included when sent —
    // except `finishedAt`, which is meant to be cleared when a finished step goes back to running.
    // `iteration` is never patched: it is part of the key this row was found by.
    const patch: Partial<Doc<"steps">> = { nodeType, status, attempt, finishedAt };
    if (args.input !== undefined) patch.input = args.input;
    if (args.output !== undefined) patch.output = args.output;
    if (args.error !== undefined) patch.error = args.error;
    if (args.warnings !== undefined) patch.warnings = args.warnings;
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
      // Any row at all: a loop body node that ran has one per pass, and none of them is `skipped`.
      if (await anyStepFor(ctx, executionId, nodeId)) continue;
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
