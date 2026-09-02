import { ConvexError, v } from "convex/values";

import { limitsForPlan } from "../lib/plans";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import { executionCreateArgs, executionStatusValidator, stepMarkArgs } from "./lib/validators";
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
