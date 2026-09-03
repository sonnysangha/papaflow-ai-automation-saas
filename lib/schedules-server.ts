import { getRun, start } from "workflow/api";

import type { Id } from "@/convex/_generated/dataModel";
import {
  getScheduleForWorkflow,
  getWorkflowForRun,
  setScheduleEnabled,
  setScheduleRunId,
  upsertSchedule,
  type WorkflowForRun,
} from "@/lib/engine-client";
import { nextFireTime, validateSchedule } from "@/lib/schedule";
import { parseScheduleInputs, scheduleTriggerNode } from "@/nodes/triggers/schedule";
import { scheduler } from "@/workflows/scheduler";

/**
 * Turning a Schedule trigger on and off — the half of the operation that no client can do.
 *
 * A schedule is two things at once: a row in `schedules`, and a durable Workflow SDK run sleeping
 * until the next occurrence. Only code that can reach both can keep them agreeing, so both moves
 * live here — validate, upsert, `start()`, store the run id; or cancel the run and disable the row.
 *
 * Two callers, one behaviour: the `publishWorkflow` server action (publishing *is* enabling, which
 * is the whole point of this module existing) and `POST /api/schedules`, kept for the clients that
 * still call it. Both run in the Next app, where `start()` is supported — "The `start()` function
 * programmatically triggers workflow executions from runtime contexts such as API routes, Server
 * Actions, or other server-side code" (`node_modules/workflow/docs/foundations/starting-workflows.mdx`).
 *
 * No `"use server"` directive here, deliberately: this module is reachable from workflow code's
 * import graph, and `node_modules/workflow/docs/api-reference/workflow-next/with-workflow.mdx`
 * says to "Keep `"use server"` on the files that define your Server Actions, and move shared logic
 * into separate modules that don't carry the directive."
 *
 * Gating is the middle of CLAUDE.md rule 3's three layers: the caller resolves the plan (a Clerk
 * concern) and this module judges the interval against it. Nothing here trusts a client-supplied
 * cron — what gets scheduled is always the *saved* graph.
 */

/** The Clerk feature slug that lifts the interval floor. `org:`-prefixed at the `has()` call. */
export const SCHEDULES_FEATURE = "schedules";

/**
 * The plan whose `minScheduleMinutes` an entitled org is judged against. `pro` and `team` are both
 * one minute (`lib/plans.ts`); naming one of them keeps the floor in `PLAN_LIMITS` rather than
 * scattering a second magic number through the callers.
 */
const ENTITLED_PLAN = "pro";

/**
 * The plan a schedule's interval is actually judged against: the org's own, unless it holds the
 * `schedules` feature, which lifts the floor for an org whose plan claim lags behind its billing.
 *
 * Both callers resolve it the same way, which is why it is a function rather than two `?:`s.
 */
export function schedulePlan({ plan, entitled }: { plan: string; entitled: boolean }): string {
  return entitled ? ENTITLED_PLAN : plan;
}

/** Why a schedule could not be enabled or paused. Mapped to HTTP status by `SCHEDULE_ERROR_STATUS`. */
export type ScheduleErrorCode =
  | "not_found"
  | "upstream_error"
  | "no_schedule_trigger"
  | "invalid_schedule"
  | "invalid_cron"
  | "invalid_timezone"
  | "too_frequent";

/** The status `POST /api/schedules` answers each failure with. */
export const SCHEDULE_ERROR_STATUS: Record<ScheduleErrorCode, number> = {
  not_found: 404,
  upstream_error: 502,
  no_schedule_trigger: 400,
  invalid_schedule: 400,
  invalid_cron: 400,
  invalid_timezone: 400,
  // "Your plan will not do that" rather than "that is not a schedule" — the only one worth
  // offering an upgrade for.
  too_frequent: 403,
};

export type ScheduleFailure = { ok: false; code: ScheduleErrorCode; error: string };

export type EnableScheduleInput = {
  workflowId: string;
  orgId: string;
  /** Who asked. Informational — it lands in the server log, never on the row. */
  userId?: string;
  /** Plan slug the interval is judged against; use `schedulePlan()` to resolve it. */
  plan: string;
  /**
   * The saved workflow, when the caller has already read it (the publish action has). Omit it and
   * this reads it — `undefined` means "not read yet", `null` means "read, and there is none".
   */
  workflow?: WorkflowForRun;
};

export type EnableScheduleSuccess = {
  ok: true;
  /** True when the schedule was already running on exactly this cron and was left alone. */
  unchanged: boolean;
  scheduleId: string;
  cron: string;
  timezone: string;
  nextAt: number | null;
  runId: string;
};

export type EnableScheduleResult = EnableScheduleSuccess | ScheduleFailure;

export type PauseScheduleInput = {
  workflowId: string;
  orgId: string;
  /** Shown in the run inspector as the cancel reason. Defaults to a paused-schedule sentence. */
  reason?: string;
};

export type PauseScheduleResult =
  | { ok: true; scheduled: boolean; scheduleId?: string }
  | ScheduleFailure;

/** One node as the stored graph carries it (`v.any()` on the Convex side). */
type StoredNodeShape = { data?: { nodeType?: unknown; inputs?: unknown } | null } | null;

/**
 * True when Convex refused the argument rather than the request: a `workflowId` that is not even
 * shaped like an id never names a workflow, so the caller answers "no such workflow" rather than
 * leaking a 500.
 */
function isMalformedId(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /ArgumentValidationError|Validator error|Invalid argument/i.test(message);
}

function failure(code: ScheduleErrorCode, error: string): ScheduleFailure {
  return { ok: false, code, error };
}

/**
 * Cancels a scheduler run, best effort. A run that has already finished, been cancelled, or been
 * garbage-collected is not a failure here: what the caller actually wants is "nothing is firing
 * this schedule any more", and a run that no longer exists satisfies that.
 */
async function cancelSchedulerRun(runId: string, cancelReason: string): Promise<void> {
  try {
    await getRun(runId).cancel({ cancelReason });
  } catch (cause) {
    console.warn(
      `schedules: could not cancel scheduler run ${runId}`,
      cause instanceof Error ? cause.message : cause,
    );
  }
}

/** The workflow's schedule row, or a failure the caller can answer with. */
async function readSchedule(
  workflowId: string,
  orgId: string,
): Promise<{ ok: true; schedule: Awaited<ReturnType<typeof getScheduleForWorkflow>> } | ScheduleFailure> {
  try {
    return { ok: true, schedule: await getScheduleForWorkflow(workflowId, orgId) };
  } catch (cause) {
    if (isMalformedId(cause)) return failure("not_found", "No such workflow.");
    console.error("schedules: could not read the schedule", cause);
    return failure("upstream_error", "Could not reach the workflow store. Try again.");
  }
}

/**
 * The Schedule trigger node in a saved graph, or null.
 *
 * Pure, and deliberately loose about the graph's shape: `workflows.graph` is `v.any()` on the
 * Convex side, so anything read out of it is checked before it is trusted.
 */
export function findScheduleTrigger(graph: unknown): StoredNodeShape | null {
  const nodes = (graph as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return null;
  return (
    (nodes as StoredNodeShape[]).find((node) => node?.data?.nodeType === scheduleTriggerNode.type) ??
    null
  );
}

/** True when the *saved* graph starts on a Schedule trigger — the only kind publishing schedules. */
export function hasScheduleTrigger(graph: unknown): boolean {
  return findScheduleTrigger(graph) !== null;
}

/** Where publishing (or unpublishing) leaves the workflow and its schedule. */
export type PublishDecision = {
  status: "active" | "paused";
  schedule: "enable" | "pause";
};

/**
 * What Publish means, as a pure function — the whole decision the server action makes, with no
 * Clerk, Convex or Workflow SDK anywhere near it.
 *
 * Publishing a graph that has *no* Schedule trigger still pauses the schedule rather than leaving
 * it: a row left over from a trigger the user has since replaced must never fire the graph that
 * replaced it. `pauseSchedule` is a no-op when there is no row, which is the usual case.
 */
export function publishDecision({
  publish,
  scheduleTrigger,
}: {
  publish: boolean;
  scheduleTrigger: boolean;
}): PublishDecision {
  if (!publish) return { status: "paused", schedule: "pause" };
  return { status: "active", schedule: scheduleTrigger ? "enable" : "pause" };
}

/**
 * Starts (or restarts) the run that fires this workflow's Schedule trigger.
 *
 * What fires is the *saved* graph, not anything the caller sent: an unsaved change to the interval
 * simply is not scheduled yet, which is also what the canvas' "Saved" indicator says.
 *
 * The row is written before the run is started, because its id is the run's only argument; the run
 * id is written back after, so a row with `enabled: true` and no `runId` is a schedule whose run is
 * still being enqueued rather than one with a lost run.
 */
export async function enableSchedule(input: EnableScheduleInput): Promise<EnableScheduleResult> {
  const { workflowId, orgId, userId, plan } = input;

  const read = await readSchedule(workflowId, orgId);
  if (!read.ok) return read;
  const existing = read.schedule;

  const workflow =
    input.workflow !== undefined
      ? input.workflow
      : await getWorkflowForRun(workflowId as Id<"workflows">, orgId);
  if (!workflow) return failure("not_found", "No such workflow.");

  const triggerNode = findScheduleTrigger(workflow.graph);
  if (!triggerNode) {
    return failure(
      "no_schedule_trigger",
      "Add a Schedule trigger to this workflow and save before enabling it.",
    );
  }

  const spec = parseScheduleInputs(triggerNode.data?.inputs);
  if (!spec) return failure("invalid_schedule", "This Schedule trigger is not configured yet.");

  const validation = validateSchedule(spec, plan);
  if (!validation.ok) return failure(validation.error.code, validation.error.message);

  const { cron, timezone } = validation;

  // Already running exactly this: leave the sleeping run alone. Restarting it would move the next
  // fire time, so publishing a workflow that is already published would quietly delay it.
  if (
    existing?.enabled &&
    existing.runId &&
    existing.cron === cron &&
    existing.timezone === timezone
  ) {
    return {
      ok: true,
      unchanged: true,
      scheduleId: existing._id,
      cron,
      timezone,
      nextAt: existing.nextAt ?? null,
      runId: existing.runId,
    };
  }

  // Anything else — a paused schedule, or an edited cron — is a new run, so the old one goes first.
  if (existing?.runId) {
    await cancelSchedulerRun(existing.runId, `Schedule changed for workflow ${workflowId}`);
  }

  const nextAt = nextFireTime({ mode: "cron", cron, timezone })?.getTime();
  const scheduleId = await upsertSchedule({
    orgId,
    workflowId: workflowId as Id<"workflows">,
    cron,
    timezone,
    enabled: true,
    nextAt,
  });

  const run = await start(
    scheduler,
    [{ scheduleId, cron, timezone }],
    // Plaintext run metadata, filterable in the run inspector. Ids only (CLAUDE.md rule 1).
    { attributes: { scheduleId, orgId } },
  );
  await setScheduleRunId({ scheduleId, orgId, runId: run.runId });

  console.log("schedules:enabled", { scheduleId, workflowId, orgId, cron, runId: run.runId, userId });

  return {
    ok: true,
    unchanged: false,
    scheduleId,
    cron,
    timezone,
    nextAt: nextAt ?? null,
    runId: run.runId,
  };
}

/**
 * Stops firing this workflow's schedule: cancel the sleeping run, then disable the row.
 *
 * Idempotent — a schedule that was never enabled, or has already been paused, is still a success.
 * Publish can be pressed twice, and a second press must not be an error.
 */
export async function pauseSchedule(input: PauseScheduleInput): Promise<PauseScheduleResult> {
  const { workflowId, orgId } = input;

  const read = await readSchedule(workflowId, orgId);
  if (!read.ok) return read;
  const existing = read.schedule;
  if (existing === null) return { ok: true, scheduled: false };

  if (existing.runId) {
    await cancelSchedulerRun(
      existing.runId,
      input.reason ?? `Schedule paused for workflow ${workflowId}`,
    );
  }
  await setScheduleEnabled({ scheduleId: existing._id, orgId, enabled: false });

  return { ok: true, scheduled: true, scheduleId: existing._id };
}
