import { getOrgPlan } from "@/lib/billing";
import {
  getSchedule,
  markScheduleFired,
  setScheduleRunId,
  startRun,
} from "@/lib/engine-client";
import { nextFireTime } from "@/lib/schedule";

/**
 * The scheduler's I/O. `workflows/scheduler.ts` is a loop of `sleep()`s and nothing else; every
 * clock reading, Convex read and run start happens here (CLAUDE.md rule 4).
 *
 * "Every clock reading" is the part that is easy to miss: `Date` inside a `"use workflow"` function
 * is seeded so a replay reproduces the original run, which is exactly wrong for "when is the next
 * 9am?". `computeNext` exists to ask that question from somewhere the answer is allowed to move.
 *
 * The file path and the export names are permanent: the compiler derives each step's id from them
 * (`step//./workflows/steps/schedule-steps//fireSchedule`), and a schedule chains itself with
 * `deploymentId: "latest"`, which only upgrades a run when the ids still match.
 */

/** What one tick of the scheduler needs to know. All plain JSON: it crosses a step boundary. */
export type FireScheduleInput = {
  scheduleId: string;
  /** The expression the run was started with; the row's copy is only re-read to check `enabled`. */
  cron: string;
  timezone?: string;
  /** The instant this tick was *due* — not when the step woke. Identical across retries. */
  firedAt: number;
};

/**
 * The next fire time after now, in epoch milliseconds, or null when the expression will never fire
 * again (or stopped being an expression at all — an edited graph, a deploy that changed nothing
 * here). The scheduler treats null as "stop", because sleeping forever is worse than stopping.
 */
export async function computeNext(cron: string, timezone?: string): Promise<number | null> {
  "use step";

  const next = nextFireTime({ mode: "cron", cron, timezone }, new Date());
  console.log("computeNext", { cron, timezone, nextAt: next?.toISOString() ?? null });
  return next === null ? null : next.getTime();
}

/**
 * One tick: start the workflow this schedule points at, and record that the tick was used.
 *
 * Returns false when there is nothing left to fire — the schedule was paused, or the workflow (and
 * with it the row) was deleted — which is how a cancelled-in-spirit scheduler run ends itself
 * without anyone having to cancel it. `enabled` is re-read here rather than carried in the
 * workflow's arguments precisely because a run can be days into a sleep by the time it matters.
 *
 * Re-runnable, which a step must be (CLAUDE.md rule 7): the tick is claimed with `markScheduleFired`
 * *before* the run is started, and a retry whose `lastFiredAt` already covers `firedAt` returns
 * without starting anything. Claiming first means a crash in the window between the two loses one
 * tick; the alternative loses nothing but can run the workflow twice, and a duplicate run of
 * "email the team" is the worse failure.
 *
 * A refused start (the org is over its monthly run limit, Convex is briefly unavailable) is logged
 * and swallowed on purpose: a schedule that deletes itself the first time a free plan runs out of
 * runs would be a much worse bug than a missed hour.
 */
export async function fireSchedule({
  scheduleId,
  cron,
  timezone,
  firedAt,
}: FireScheduleInput): Promise<boolean> {
  "use step";

  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    console.log("fireSchedule:gone", { scheduleId });
    return false;
  }
  if (!schedule.enabled) {
    console.log("fireSchedule:paused", { scheduleId });
    return false;
  }
  if (schedule.lastFiredAt !== undefined && schedule.lastFiredAt >= firedAt) {
    console.log("fireSchedule:already-fired", { scheduleId, firedAt });
    return true;
  }

  const next = nextFireTime({ mode: "cron", cron, timezone }, new Date(firedAt));
  await markScheduleFired({
    scheduleId,
    orgId: schedule.orgId,
    firedAt,
    nextAt: next?.getTime(),
  });

  try {
    // No session out here, so the plan comes from the Clerk Backend API and is snapshotted onto the
    // execution by `startRun` (CLAUDE.md rule 10).
    const planSlug = await getOrgPlan(schedule.orgId);
    const { executionId } = await startRun({
      orgId: schedule.orgId,
      workflowId: schedule.workflowId,
      trigger: {
        type: "schedule",
        payload: { firedAt: new Date(firedAt).toISOString(), scheduleId },
      },
      planSlug,
    });
    console.log("fireSchedule:started", { scheduleId, executionId, firedAt });
  } catch (cause) {
    console.error(
      `fireSchedule: could not start ${schedule.workflowId} for schedule ${scheduleId}`,
      cause instanceof Error ? cause.message : cause,
    );
  }

  return true;
}

/**
 * Points the schedule row at the scheduler run that is now sleeping on it.
 *
 * Called once per continue-as-new. It is what makes "Pause" keep working after a handover: the
 * route cancels `schedules.runId`, so that id has to be the newest run rather than the one that
 * has just finished. A schedule deleted in the meantime is left alone — the fresh run will find no
 * row on its first tick and return.
 */
export async function storeSchedulerRun(scheduleId: string, runId: string): Promise<void> {
  "use step";

  const schedule = await getSchedule(scheduleId);
  if (!schedule) return;

  await setScheduleRunId({ scheduleId, orgId: schedule.orgId, runId });
  console.log("scheduler:continued", { scheduleId, runId });
}
