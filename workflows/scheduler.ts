import { sleep } from "workflow";
import { start } from "workflow/api";

import {
  computeNext,
  fireSchedule,
  storeSchedulerRun,
} from "@/workflows/steps/schedule-steps";

/**
 * The schedule, as a run that sleeps.
 *
 * There is no cron server and no polling: enabling a schedule starts one durable run of this
 * function, which asks a step when the next occurrence is, `sleep()`s until that exact `Date`, fires
 * the workflow from another step, and goes round again. Sleeping costs nothing and has no maximum,
 * so a daily schedule is a run that is asleep 99.99% of the time, and pausing is
 * `getRun(runId).cancel()` in `app/api/schedules/route.ts` — the run stops at its next suspension
 * point and there is nothing left to tidy up.
 *
 * Orchestration only (CLAUDE.md rule 4). Note what that costs and buys: `Date.now()` here is seeded
 * for deterministic replay, so "what time is it?" has to be a step — which is `computeNext`'s whole
 * job — and in exchange a crash, a deploy or a region failover in the middle of a three-week sleep
 * resumes exactly where it left off.
 *
 * The name and the path are permanent: they are the workflow's id
 * (`workflow//./workflows/scheduler//scheduler`), and a run that hands over with
 * `deploymentId: "latest"` only lands on the new deployment while that id still resolves there.
 */

/**
 * How many ticks one run handles before handing over to a fresh one.
 *
 * The event log is the limit, not time. Each iteration writes roughly eight events (a step's
 * scheduled/started/completed, the timer's two, the fire step's three) against a 25,000-event cap,
 * and every wake replays the whole log — so a run that ticks every minute forever would slow down
 * and eventually die. Two hundred iterations keeps each run's log around 1,600 events, comfortably
 * inside the ~2,000 where replay starts to drag.
 *
 * `SCHEDULER_MAX_ITERATIONS` overrides it, which is how the phase check forces a handover to happen
 * within a couple of minutes instead of a couple of hundred. `process.env` in workflow code is a
 * frozen snapshot taken when the run started (the SDK's workflow-globals reference), so a given run
 * reads one value for its whole life and its replays agree with it.
 */
const DEFAULT_MAX_ITERATIONS = 200;

/** The scheduler's arguments. Serialized into the event log, and again into every handover. */
export type SchedulerInput = {
  scheduleId: string;
  cron: string;
  timezone?: string;
};

export type SchedulerResult = {
  scheduleId: string;
  /**
   * Why this run ended: the schedule was paused or deleted, its expression has no future
   * occurrences left, or the run reached its iteration cap and handed over to `runId`.
   */
  stopped: "disabled" | "exhausted" | "continued";
  iterations: number;
  runId?: string;
};

function maxIterations(): number {
  const configured = Number(process.env.SCHEDULER_MAX_ITERATIONS);
  return Number.isFinite(configured) && configured >= 1
    ? Math.floor(configured)
    : DEFAULT_MAX_ITERATIONS;
}

export async function scheduler(args: SchedulerInput): Promise<SchedulerResult> {
  "use workflow";

  const { scheduleId, cron, timezone } = args;
  const limit = maxIterations();

  for (let iteration = 0; iteration < limit; iteration++) {
    const nextAt = await computeNext(cron, timezone);
    // An expression with nothing left to fire (or one that stopped parsing) ends the chain rather
    // than sleeping forever. The row keeps `enabled: true`, so the canvas still shows the schedule
    // and re-enabling it starts a fresh run.
    if (nextAt === null) return { scheduleId, stopped: "exhausted", iterations: iteration };

    // No maximum and no compute held: a `Date` rather than a duration, so a run that wakes late
    // (or replays) still targets the instant the schedule was actually due.
    await sleep(new Date(nextAt));

    // `false` means the schedule is paused or gone. Returning is how the run ends itself: a pause
    // normally cancels this run outright, and this is the path for the cases where nothing could
    // (a deleted workflow, a cancel that raced the wake).
    const fired = await fireSchedule({ scheduleId, cron, timezone, firedAt: nextAt });
    if (!fired) return { scheduleId, stopped: "disabled", iterations: iteration + 1 };
  }

  // Continue-as-new. `start()` inside a workflow is step-backed in v5, so the handover is one more
  // recorded step rather than a hole in the log, and `deploymentId: "latest"` is what lets a
  // schedule enabled months ago pick up today's code (`args` is the migration boundary: keep this
  // function's name, path and argument shape backward-compatible).
  const run = await start(scheduler, [args], { deploymentId: "latest" });
  // Written last, and from a step: "Pause" cancels `schedules.runId`, so it has to name the run
  // that is about to do the sleeping rather than this one, which is finishing.
  await storeSchedulerRun(scheduleId, run.runId);

  return { scheduleId, stopped: "continued", iterations: limit, runId: run.runId };
}
