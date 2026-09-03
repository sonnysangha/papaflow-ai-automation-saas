import { ConvexError, v } from "convex/values";

import { limitsForPlan } from "../lib/plans";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { workflowStatusValidator } from "./lib/validators";

/**
 * The `schedules` table, and the alarm clock that rings it.
 *
 * **Convex is the alarm clock, the Next app is the brain, Vercel Workflows is the muscle.** A
 * published schedule is one row here plus one durable Convex scheduled job (`_scheduled_functions`)
 * armed for the next occurrence. When the job fires, `fire` POSTs to
 * `${APP_ORIGIN}/api/engine/schedule-tick` with `ENGINE_SECRET`; the app decides whether the
 * workflow should run, starts it on Vercel Workflows exactly as every other trigger does, and hands
 * back the *next* fire time, which this file arms in turn. Nothing polls, and nothing sleeps.
 *
 * This replaced a sleeping Workflow SDK run per schedule. That design cost roughly eight workflow
 * events per tick and left one Active run per schedule forever; a Convex job costs one function
 * call, and Workflow events are now spent only on runs a user asked for.
 *
 * Only one function here is reachable from a browser — `getForWorkflow`, which the config panel
 * subscribes to. Every write is internal, and the two the app needs (`arm`, `disarm`) reach Convex
 * through the secret-checked wrappers in `convex/engine.ts`: a schedule is a row *and* a scheduled
 * job, and a client that could flip `enabled` on its own could leave the two disagreeing about
 * whether this workflow is scheduled.
 *
 * `mode` and `everyMinutes` are deliberately not stored: they are how the *user* described the
 * schedule and they live on the trigger node's inputs in the graph. What fires is the cron.
 *
 * Convex APIs used here are verified against `node_modules/convex@1.45.0`:
 * `ctx.scheduler.runAt(timestamp, fnRef, args)` and `runAfter(delayMs, …)` return an
 * `Id<"_scheduled_functions">`, `ctx.scheduler.cancel(id)` takes one, and `ctx.db.system.get(id)`
 * reads the job row (`server/scheduler.d.ts`, `server/database.d.ts`, `server/schema.d.ts`).
 */

/** Where the alarm rings. Kept next to the route it names so a rename breaks in one place. */
const TICK_PATH = "/api/engine/schedule-tick";

/** How many deliveries of one tick to attempt before giving up on it. */
const MAX_ATTEMPTS = 3;

/** Backoff between deliveries: one minute, then two, then three. */
const RETRY_BASE_MS = 60_000;

/**
 * How far out a schedule re-arms itself when the app could not be reached at all.
 *
 * The tick is lost, but the schedule is not: a deployment that comes back within the quarter hour
 * picks up on the next occurrence rather than needing someone to press Publish again.
 */
const FALLBACK_MS = 15 * 60_000;

/** Longest error text kept on the row. It is rendered on the canvas, not in a log. */
const MAX_ERROR_LENGTH = 300;

/** What the config panel sees. Nothing here is secret; the projection is explicit anyway. */
const scheduleSummary = v.object({
  _id: v.id("schedules"),
  cron: v.string(),
  timezone: v.optional(v.string()),
  enabled: v.boolean(),
  nextAt: v.optional(v.number()),
  lastFiredAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
});

/** The whole row, for the engine: the app needs `orgId` and `workflowId` to start the run. */
export const scheduleRow = v.object({
  _id: v.id("schedules"),
  orgId: v.string(),
  workflowId: v.id("workflows"),
  cron: v.string(),
  timezone: v.optional(v.string()),
  enabled: v.boolean(),
  jobId: v.optional(v.id("_scheduled_functions")),
  nextAt: v.optional(v.number()),
  plannedAt: v.optional(v.number()),
  lastFiredAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  attempts: v.optional(v.number()),
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
    jobId: schedule.jobId,
    nextAt: schedule.nextAt,
    plannedAt: schedule.plannedAt,
    lastFiredAt: schedule.lastFiredAt,
    lastError: schedule.lastError,
    attempts: schedule.attempts,
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
 * Loads a schedule and, when the caller named an org, re-checks it against the row. The `arm` and
 * `disarm` mutations are reached with a shared secret rather than a session, so `orgId` is an
 * argument rather than something Convex can take on trust (CLAUDE.md rule 5). Convex's own
 * scheduled job passes no org: it is already inside the deployment.
 */
async function scheduleInOrg(
  ctx: QueryCtx,
  scheduleId: Id<"schedules">,
  orgId?: string,
): Promise<Doc<"schedules">> {
  const schedule = await ctx.db.get(scheduleId);
  if (!schedule || (orgId !== undefined && schedule.orgId !== orgId)) {
    throw new ConvexError({ code: "not_found" });
  }
  return schedule;
}

/**
 * Cancels a pending alarm, if there is one.
 *
 * Deliberately `pending`-only. Cancelling an *in-progress* action is not an error but has a nasty
 * side effect — "any new functions it tries to schedule will be canceled"
 * (`server/scheduler.d.ts`) — which is exactly what a tick re-arming itself does, and cancelling a
 * job that has already completed throws. Both cases are reached in normal life: `fire` runs inside
 * the very job the row points at. `claimTick` clears `jobId` for that reason too; this guard is the
 * belt to its braces.
 */
async function cancelPendingJob(ctx: MutationCtx, jobId: Id<"_scheduled_functions">): Promise<void> {
  const job = await ctx.db.system.get(jobId);
  if (job?.state.kind === "pending") await ctx.scheduler.cancel(jobId);
}

/** One line of an error, short enough to render on the canvas. */
function shortError(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);
}

/**
 * The schedule the canvas' Schedule trigger panel shows, live, together with the plan's smallest
 * allowed interval and whether the workflow is published — the panel needs all three to decide what
 * to say, and one subscription is one re-render when a tick fires and moves `nextAt`.
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
              nextAt: schedule.nextAt,
              lastFiredAt: schedule.lastFiredAt,
              lastError: schedule.lastError,
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
 * Internal half of `api.engine.getSchedule`, and what `fire` reads when its alarm goes off.
 *
 * The job carries nothing but a `scheduleId` and the instant it was armed for, so this is where a
 * tick learns which workflow to start and whether it still should — deliberately re-read on every
 * tick rather than captured in the job's arguments.
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
 * The alarm is *not* set here. `enableSchedule` writes the row first because the id is the job's
 * only real argument, then calls `arm` — which is also what cancels the job left over from the
 * previous cron, so `jobId` is deliberately carried through this write rather than cleared. A last
 * error and a retry count belong to the schedule that has just been replaced, and do not.
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
    const fields = {
      cron,
      timezone,
      enabled,
      nextAt,
      lastError: undefined,
      attempts: undefined,
      updatedAt: Date.now(),
    };

    if (existing) {
      if (existing.orgId !== orgId) throw new ConvexError({ code: "not_found" });
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }

    return await ctx.db.insert("schedules", { orgId, workflowId, ...fields });
  },
});

/* -------------------------------------------------------------------------------------------------
 * The alarm clock.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Arms the schedule for `nextAt`: cancel whatever was pending, schedule `fire`, remember the job.
 *
 * Called from three places, and it has to mean the same thing in all of them — `enableSchedule`
 * when a workflow is published, `recordTick` after a tick that worked, and the fallback path when
 * the app could not be reached. `plannedAt` is stored alongside `nextAt` because it is what travels
 * with the job: a tick is claimed by the instant it was *due*, never by the instant it woke.
 *
 * A disabled row is left alone rather than armed. Pausing must be the last word, even if a tick was
 * already in flight when someone pressed Unpublish.
 */
export const arm = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    /** Present when the app is asking on a user's behalf; absent for Convex's own tick. */
    orgId: v.optional(v.string()),
    nextAt: v.number(),
  },
  returns: v.union(v.id("_scheduled_functions"), v.null()),
  handler: async (
    ctx,
    { scheduleId, orgId, nextAt },
  ): Promise<Id<"_scheduled_functions"> | null> => {
    const schedule = await scheduleInOrg(ctx, scheduleId, orgId);
    if (!schedule.enabled) return null;

    if (schedule.jobId) await cancelPendingJob(ctx, schedule.jobId);

    const jobId = await ctx.scheduler.runAt(nextAt, internal.schedules.fire, {
      scheduleId,
      plannedAt: nextAt,
      attempt: 0,
    });
    await ctx.db.patch(scheduleId, { jobId, nextAt, plannedAt: nextAt, updatedAt: Date.now() });
    return jobId;
  },
});

/**
 * Arms the *same* tick again after a delivery failure — the backoff sibling of `arm`.
 *
 * `plannedAt` and `attempt` are carried through unchanged, so the retry still speaks for the tick
 * that was due and does not try to claim a second one. It lives in a mutation rather than in the
 * action so the row's `jobId`, `attempts` and `lastError` commit in the same transaction as the
 * job: an action that scheduled the retry and then failed to write the row would leave a pending
 * alarm nobody could cancel.
 */
export const armRetry = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    plannedAt: v.number(),
    /** The attempt that just failed; the retry runs as `attempt + 1`. */
    attempt: v.number(),
    lastError: v.string(),
  },
  returns: v.union(v.id("_scheduled_functions"), v.null()),
  handler: async (
    ctx,
    { scheduleId, plannedAt, attempt, lastError },
  ): Promise<Id<"_scheduled_functions"> | null> => {
    const schedule = await ctx.db.get(scheduleId);
    if (!schedule || !schedule.enabled) return null;

    if (schedule.jobId) await cancelPendingJob(ctx, schedule.jobId);

    const jobId = await ctx.scheduler.runAfter(
      RETRY_BASE_MS * (attempt + 1),
      internal.schedules.fire,
      { scheduleId, plannedAt, attempt: attempt + 1 },
    );
    await ctx.db.patch(scheduleId, {
      jobId,
      attempts: attempt + 1,
      lastError: shortError(lastError),
      updatedAt: Date.now(),
    });
    return jobId;
  },
});

/**
 * Stops the schedule: cancel the pending alarm and turn the row off.
 *
 * Idempotent, and tolerant of a row that has already gone — Publish can be pressed twice, and the
 * app calls this without first checking whether there was ever anything to stop. `lastError` is set
 * when the app refused the tick (so the panel can say why the schedule stopped) and cleared when a
 * person pressed Unpublish.
 */
export const disarm = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    orgId: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { scheduleId, orgId, lastError }): Promise<null> => {
    const schedule = await ctx.db.get(scheduleId);
    if (!schedule) return null;
    if (orgId !== undefined && schedule.orgId !== orgId) throw new ConvexError({ code: "not_found" });

    if (schedule.jobId) await cancelPendingJob(ctx, schedule.jobId);

    await ctx.db.patch(scheduleId, {
      enabled: false,
      jobId: undefined,
      nextAt: undefined,
      plannedAt: undefined,
      lastError: lastError === undefined ? undefined : shortError(lastError),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Claims one tick, and answers whether this delivery may go on to start a run.
 *
 * This is the exactly-once guard. `plannedAt` is the instant the schedule was *due*, so it is the
 * same value however many times the alarm is delivered, and a delivery whose tick is already
 * covered by `lastFiredAt` refuses rather than starting a second run. Claiming *before* the run is
 * started means a crash in the window between the two loses one tick; the other order loses nothing
 * but can run the workflow twice, and a duplicate "email the team" is the worse failure.
 *
 * `jobId` is cleared because the job it names is the one calling this: it can no longer be
 * cancelled, and leaving it behind would have the next `arm` reach for a job that has finished.
 */
export const claimTick = internalMutation({
  args: { scheduleId: v.id("schedules"), plannedAt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { scheduleId, plannedAt }) => {
    const schedule = await ctx.db.get(scheduleId);
    if (!schedule || !schedule.enabled) return false;
    if (schedule.lastFiredAt !== undefined && schedule.lastFiredAt >= plannedAt) return false;

    await ctx.db.patch(scheduleId, {
      lastFiredAt: plannedAt,
      jobId: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

/**
 * Records how a tick went and arms the next one, in a single transaction.
 *
 * `lastError` is written exactly as it is given, so a tick that worked clears the sentence the
 * canvas was showing. `nextAt` absent means there is nothing to arm — a cron with no future
 * occurrence — which leaves an enabled schedule with no alarm rather than one sleeping forever.
 */
export const recordTick = internalMutation({
  args: {
    scheduleId: v.id("schedules"),
    lastFiredAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    attempts: v.optional(v.number()),
    nextAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { scheduleId, lastFiredAt, lastError, attempts, nextAt },
  ): Promise<null> => {
    const schedule = await ctx.db.get(scheduleId);
    if (!schedule) return null;

    await ctx.db.patch(scheduleId, {
      ...(lastFiredAt === undefined ? {} : { lastFiredAt }),
      lastError: lastError === undefined ? undefined : shortError(lastError),
      attempts,
      nextAt,
      updatedAt: Date.now(),
    });

    if (nextAt !== undefined) await ctx.runMutation(internal.schedules.arm, { scheduleId, nextAt });
    return null;
  },
});

/** How the app answers a tick. Parsed defensively: it arrives over HTTP. */
type TickResponse = { started: boolean; executionId?: string; nextAt?: number; reason?: string };

function parseTickResponse(body: unknown): TickResponse {
  const value = (body ?? {}) as Record<string, unknown>;
  return {
    started: value.started === true,
    executionId: typeof value.executionId === "string" ? value.executionId : undefined,
    nextAt: typeof value.nextAt === "number" && Number.isFinite(value.nextAt) ? value.nextAt : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
}

/** A response body worth putting in front of a user, or "". Never the whole page. */
async function refusalText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return shortError(text).slice(0, 120);
  } catch {
    return "";
  }
}

/**
 * One tick: wake up, claim it, and ask the app to run the workflow.
 *
 * An action rather than a mutation because it makes a network call — `fetch` is available in
 * Convex's default runtime, and scheduling a *mutation* would not help anyway, since the decision
 * (is this workflow still published? what does the plan allow? what is the next occurrence?) lives
 * in the Next app, where Clerk and the Workflow SDK are.
 *
 * Three outcomes, and the difference matters:
 *
 * - **200** — the app started the run (or refused it with `run_limit`, which is not the schedule's
 *   fault) and told us when the next occurrence is. Record and re-arm.
 * - **4xx** — the app says this schedule should not be firing at all: the workflow is unpublished,
 *   deleted, or the row is off. Disarm, and keep the sentence for the canvas.
 * - **5xx, or no answer at all** — the app is having a bad minute. Back off and try the *same* tick
 *   again, up to `MAX_ATTEMPTS`; after that, arm a fallback a quarter of an hour out so the
 *   schedule recovers on its own once the deployment does.
 *
 * The claim happens on the first attempt only. A retry is a second delivery of a tick that has
 * already been claimed, and re-claiming would refuse it.
 *
 * A scheduled action runs *at most* once (`server/scheduler.d.ts`) — Convex does not retry it — so
 * everything that must survive a failure is written from a mutation, not held here.
 */
export const fire = internalAction({
  args: {
    scheduleId: v.id("schedules"),
    /** The instant this tick was due. Identical across every delivery of it. */
    plannedAt: v.number(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { scheduleId, plannedAt, attempt }): Promise<null> => {
    const schedule = await ctx.runQuery(internal.schedules.byId, { scheduleId });
    if (!schedule) {
      console.log("schedules:fire:gone", { scheduleId });
      return null;
    }
    if (!schedule.enabled) {
      console.log("schedules:fire:paused", { scheduleId });
      return null;
    }

    if (attempt === 0) {
      const claimed = await ctx.runMutation(internal.schedules.claimTick, { scheduleId, plannedAt });
      if (!claimed) {
        console.log("schedules:fire:already-claimed", { scheduleId, plannedAt });
        return null;
      }
    }

    const origin = process.env.APP_ORIGIN;
    const secret = process.env.ENGINE_SECRET;
    if (!origin || !secret) {
      // Set with `npx convex env set` on the deployment, not on Vercel: this call is outbound from
      // Convex. On the cloud dev deployment `APP_ORIGIN=http://localhost:3000` is also unreachable,
      // which lands in the `fetch` failure below with the same fallback.
      await ctx.runMutation(internal.schedules.recordTick, {
        scheduleId,
        lastFiredAt: plannedAt,
        attempts: attempt + 1,
        // Fragment, not a sentence: `ScheduleConfig.tsx` renders every `lastError` after its own
        // "Last tick could not reach the app: " label.
        lastError: "this Convex deployment has no APP_ORIGIN or ENGINE_SECRET set. Run `npx convex env set` for both.",
        nextAt: Date.now() + FALLBACK_MS,
      });
      return null;
    }

    const url = `${origin.replace(/\/+$/, "")}${TICK_PATH}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          scheduleId,
          workflowId: schedule.workflowId,
          orgId: schedule.orgId,
          plannedAt,
        }),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A fragment, not a sentence: `backOff` and `ScheduleConfig.tsx` both build on this.
      return await backOff(ctx, scheduleId, plannedAt, attempt, `${url} did not respond (${message})`);
    }

    if (response.status >= 500) {
      return await backOff(
        ctx,
        scheduleId,
        plannedAt,
        attempt,
        `got back ${response.status} from ${url} (${await refusalText(response)})`,
      );
    }

    if (!response.ok) {
      const detail = await refusalText(response);
      console.log("schedules:fire:refused", { scheduleId, status: response.status, detail });
      await ctx.runMutation(internal.schedules.disarm, {
        scheduleId,
        lastError: `the app refused this tick (${response.status}${detail ? `: ${detail}` : ""}) and this schedule has been paused. Publish the workflow again to restart it.`,
      });
      return null;
    }

    const result = parseTickResponse(await response.json().catch(() => null));
    console.log("schedules:fire:done", {
      scheduleId,
      plannedAt,
      started: result.started,
      executionId: result.executionId,
      reason: result.reason,
      nextAt: result.nextAt,
    });

    await ctx.runMutation(internal.schedules.recordTick, {
      scheduleId,
      lastFiredAt: plannedAt,
      attempts: 0,
      lastError: undefined,
      nextAt: result.nextAt,
    });
    return null;
  },
});

/**
 * The 5xx / unreachable path: another go at the same tick, or a fallback so it can recover.
 *
 * `error` is a fragment ("https://… did not respond (…)"), never a full sentence: it is stored
 * verbatim as `lastError` and `ScheduleConfig.tsx` renders every `lastError` after its own "Last
 * tick could not reach the app: " label, so building that framing in here too would double it up.
 */
async function backOff(
  ctx: { runMutation: (ref: typeof internal.schedules.armRetry | typeof internal.schedules.recordTick, args: never) => Promise<unknown> },
  scheduleId: Id<"schedules">,
  plannedAt: number,
  attempt: number,
  error: string,
): Promise<null> {
  if (attempt < MAX_ATTEMPTS) {
    console.warn("schedules:fire:retry", { scheduleId, plannedAt, attempt, error });
    await ctx.runMutation(internal.schedules.armRetry, {
      scheduleId,
      plannedAt,
      attempt,
      lastError: error,
    } as never);
    return null;
  }

  console.error("schedules:fire:gave-up", { scheduleId, plannedAt, attempt, error });
  await ctx.runMutation(internal.schedules.recordTick, {
    scheduleId,
    lastFiredAt: plannedAt,
    attempts: attempt + 1,
    lastError: `${error}. Trying again in 15 minutes.`,
    nextAt: Date.now() + FALLBACK_MS,
  } as never);
  return null;
}

/**
 * Drops a workflow's schedule, and the alarm set for it. Called when the workflow itself goes.
 *
 * Cancelling matters here in a way it did not under the old design: a Convex job whose row has been
 * deleted would still wake up, find nothing and return — harmless, but it is a function call nobody
 * asked for, and a mutation can cancel it where it could never reach the Workflow SDK.
 */
export const removeForWorkflow = internalMutation({
  args: { workflowId: v.id("workflows") },
  returns: v.null(),
  handler: async (ctx, { workflowId }): Promise<null> => {
    const schedule = await scheduleFor(ctx, workflowId);
    if (!schedule) return null;

    if (schedule.jobId) await cancelPendingJob(ctx, schedule.jobId);
    await ctx.db.delete(schedule._id);
    return null;
  },
});
