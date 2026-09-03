import { ConvexError, v } from "convex/values";

import { limitsForPlan } from "../lib/plans";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { workflowStatusValidator } from "./lib/validators";

/**
 * The `schedules` table: one row per workflow, holding the cron the scheduler run is sleeping on.
 *
 * Only one function here is reachable from a browser — `getForWorkflow`, which the config panel
 * subscribes to. Every write is internal, and reaches Convex through the secret-checked wrappers in
 * `convex/engine.ts`, because a schedule row is only half of the state: the other half is a durable
 * Workflow SDK run, and only `lib/schedules-server.ts` can move both at once (start the run, store
 * its id; cancel the run, clear it). A client that could flip `enabled` on its own would be able to
 * leave a row and a run disagreeing about whether this workflow is scheduled.
 *
 * `mode` and `everyMinutes` are deliberately not stored: they are how the *user* described the
 * schedule and they live on the trigger node's inputs in the graph. What fires is the cron.
 */

/** What the config panel sees. Nothing here is secret; the projection is explicit anyway. */
const scheduleSummary = v.object({
  _id: v.id("schedules"),
  cron: v.string(),
  timezone: v.optional(v.string()),
  enabled: v.boolean(),
  /** The scheduler run that is currently sleeping on this schedule, if any. */
  runId: v.optional(v.string()),
  nextAt: v.optional(v.number()),
  lastFiredAt: v.optional(v.number()),
  updatedAt: v.number(),
});

/** The whole row, for the engine: the step needs `orgId` and `workflowId` to start the run. */
export const scheduleRow = v.object({
  _id: v.id("schedules"),
  orgId: v.string(),
  workflowId: v.id("workflows"),
  cron: v.string(),
  timezone: v.optional(v.string()),
  enabled: v.boolean(),
  runId: v.optional(v.string()),
  nextAt: v.optional(v.number()),
  lastFiredAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export type ScheduleRow = typeof scheduleRow.type;

function toRow(schedule: Doc<"schedules">): ScheduleRow {
  return {
    _id: schedule._id,
    orgId: schedule.orgId,
    workflowId: schedule.workflowId,
    cron: schedule.cron,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    runId: schedule.runId,
    nextAt: schedule.nextAt,
    lastFiredAt: schedule.lastFiredAt,
    updatedAt: schedule.updatedAt,
  };
}

/** The workflow's schedule, or null. One row per workflow: `by_workflow` is a unique lookup here. */
async function scheduleFor(
  ctx: QueryCtx,
  workflowId: Id<"workflows">,
): Promise<Doc<"schedules"> | null> {
  return await ctx.db
    .query("schedules")
    .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
    .unique();
}

/**
 * Loads a schedule and re-checks the org it is being touched on behalf of. Every internal write
 * goes through this: the engine surface is reached with a shared secret, so `orgId` is an argument
 * rather than something Convex can take on trust (CLAUDE.md rule 5).
 */
async function scheduleInOrg(
  ctx: QueryCtx,
  scheduleId: Id<"schedules">,
  orgId: string,
): Promise<Doc<"schedules">> {
  const schedule = await ctx.db.get(scheduleId);
  if (!schedule || schedule.orgId !== orgId) throw new ConvexError({ code: "not_found" });
  return schedule;
}

/**
 * The schedule the canvas' Schedule trigger panel shows, live, together with the plan's smallest
 * allowed interval and whether the workflow is published — the panel needs all three to decide what
 * to say, and one subscription is one re-render when the scheduler fires and moves `nextAt`.
 *
 * `status` rides along because publishing *is* the schedule's switch now (`publishWorkflow` in
 * `app/(app)/w/[workflowId]/actions.ts`), so "is this running?" is two facts rather than one — and
 * the workflow document is already loaded here for the ownership check, so it costs no extra read.
 *
 * The plan comes from the session token's `pla` claim (`requireOrg`), so this is the same answer
 * `has()` would give in a route, without a round trip to Clerk.
 */
export const getForWorkflow = query({
  args: { workflowId: v.id("workflows") },
  returns: v.object({
    plan: v.string(),
    minScheduleMinutes: v.number(),
    status: workflowStatusValidator,
    schedule: v.union(scheduleSummary, v.null()),
  }),
  handler: async (ctx, { workflowId }) => {
    const { orgId, plan } = await requireOrg(ctx);

    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.orgId !== orgId) throw new ConvexError({ code: "not_found" });

    const schedule = await scheduleFor(ctx, workflowId);

    return {
      plan,
      minScheduleMinutes: limitsForPlan(plan).minScheduleMinutes,
      status: workflow.status,
      schedule:
        schedule === null
          ? null
          : {
              _id: schedule._id,
              cron: schedule.cron,
              timezone: schedule.timezone,
              enabled: schedule.enabled,
              runId: schedule.runId,
              nextAt: schedule.nextAt,
              lastFiredAt: schedule.lastFiredAt,
              updatedAt: schedule.updatedAt,
            },
    };
  },
});

/** Internal half of `api.engine.getScheduleForWorkflow`: the row, once the org has been proved. */
export const forWorkflow = internalQuery({
  args: { workflowId: v.id("workflows"), orgId: v.string() },
  returns: v.union(scheduleRow, v.null()),
  handler: async (ctx, { workflowId, orgId }) => {
    const schedule = await scheduleFor(ctx, workflowId);
    // A schedule belonging to another org reads as one that never existed.
    return schedule && schedule.orgId === orgId ? toRow(schedule) : null;
  },
});

/**
 * Internal half of `api.engine.getSchedule`. The scheduler run carries nothing but a `scheduleId`
 * through its sleeps, so this is where it learns which workflow to start and whether it still
 * should — deliberately re-read on every tick rather than captured in the workflow's arguments.
 */
export const byId = internalQuery({
  args: { scheduleId: v.id("schedules") },
  returns: v.union(scheduleRow, v.null()),
  handler: async (ctx, { scheduleId }) => {
    const schedule = await ctx.db.get(scheduleId);
    return schedule ? toRow(schedule) : null;
  },
});

/**
 * Writes the workflow's schedule, creating the row the first time. One row per workflow, so this
 * updates in place rather than inserting a second: a workflow has one Schedule trigger.
 *
 * `runId` is cleared, never set here. The row is written *before* `start()` is called (the route
 * needs the id to pass to the scheduler), so the id of the run that ends up sleeping on it arrives
 * a moment later through `setRunId` — and a row with `enabled: true` and no `runId` is a schedule
 * whose run is still being enqueued, not a schedule with a lost run.
 */
export const upsertForWorkflow = internalMutation({
  args: {
    orgId: v.string(),
    workflowId: v.id("workflows"),
    cron: v.string(),
    timezone: v.optional(v.string()),
    enabled: v.boolean(),
    nextAt: v.optional(v.number()),
  },
  returns: v.id("schedules"),
  handler: async (ctx, { orgId, workflowId, cron, timezone, enabled, nextAt }) => {
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.orgId !== orgId) throw new ConvexError({ code: "not_found" });

    const existing = await scheduleFor(ctx, workflowId);
    const fields = { cron, timezone, enabled, nextAt, runId: undefined, updatedAt: Date.now() };

    if (existing) {
      if (existing.orgId !== orgId) throw new ConvexError({ code: "not_found" });
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }

    return await ctx.db.insert("schedules", { orgId, workflowId, ...fields });
  },
});

/**
 * Pauses or resumes a schedule. Pausing also forgets the run and the next fire time, because the
 * route has just cancelled that run — leaving its id behind would let a later "enable" try to
 * cancel a run that is already gone.
 */
export const setEnabled = internalMutation({
  args: { scheduleId: v.id("schedules"), orgId: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { scheduleId, orgId, enabled }) => {
    await scheduleInOrg(ctx, scheduleId, orgId);

    await ctx.db.patch(scheduleId, {
      enabled,
      updatedAt: Date.now(),
      ...(enabled ? {} : { runId: undefined, nextAt: undefined }),
    });
    return null;
  },
});

/**
 * Records which scheduler run is sleeping on this schedule.
 *
 * Written twice in a schedule's life and then once per continue-as-new: by the route when the
 * schedule is enabled, and by the scheduler itself every time it hands over to a fresh run (the
 * loop caps at `SCHEDULER_MAX_ITERATIONS` so no single run's event log grows without bound). The
 * id is what "Pause" cancels, so it has to keep up.
 */
export const setRunId = internalMutation({
  args: { scheduleId: v.id("schedules"), orgId: v.string(), runId: v.string() },
  returns: v.null(),
  handler: async (ctx, { scheduleId, orgId, runId }) => {
    await scheduleInOrg(ctx, scheduleId, orgId);

    await ctx.db.patch(scheduleId, { runId, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Claims one tick.
 *
 * `firedAt` is the instant the schedule was *due*, not the instant the step woke up, so it is the
 * same value on a retry — which is what makes `fireSchedule` safe to re-run (CLAUDE.md rule 7): the
 * step compares it against `lastFiredAt` and refuses to start a second run for a tick that has
 * already been claimed.
 */
export const markFired = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    orgId: v.string(),
    firedAt: v.number(),
    nextAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { scheduleId, orgId, firedAt, nextAt }) => {
    await scheduleInOrg(ctx, scheduleId, orgId);

    await ctx.db.patch(scheduleId, { lastFiredAt: firedAt, nextAt, updatedAt: Date.now() });
    return null;
  },
});

/** Drops a workflow's schedule. Called when the workflow itself goes. */
export const removeForWorkflow = internalMutation({
  args: { workflowId: v.id("workflows") },
  returns: v.null(),
  handler: async (ctx, { workflowId }) => {
    const schedule = await scheduleFor(ctx, workflowId);
    if (schedule) await ctx.db.delete(schedule._id);
    return null;
  },
});
