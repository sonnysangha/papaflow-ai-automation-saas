"use server";

import { auth } from "@clerk/nextjs/server";

import type { Id } from "@/convex/_generated/dataModel";
import { getWorkflowForRun, setWorkflowStatus, startRun } from "@/lib/engine-client";
import { planFromClaim } from "@/lib/plans";
import {
  enableSchedule,
  hasScheduleTrigger,
  pauseSchedule,
  publishDecision,
  SCHEDULES_FEATURE,
  schedulePlan,
} from "@/lib/schedules-server";

/**
 * The Manual trigger. This is the only module in the engine's import graph with a `"use server"`
 * directive: the directive turns every export into a client-callable endpoint, so it must never sit
 * on a file that workflow or step code imports.
 *
 * The client sends nothing that is trusted. `workflowId` is checked against the caller's org inside
 * Convex (`getWorkflowForRun` returns null for another org's workflow) and `sampleJson` is only
 * ever parsed as data.
 */
export async function runWorkflow(
  workflowId: string,
  sampleJson: string,
): Promise<{ executionId: string; runId: string }> {
  const { isAuthenticated, orgId, userId, sessionClaims } = await auth();
  if (!isAuthenticated || !orgId) throw new Error("unauthorized");

  // Clerk is the source of truth for billing; the plan rides on the session token and is
  // snapshotted onto the execution, because the engine itself has no session to read it from.
  const planSlug = planFromClaim((sessionClaims as { pla?: unknown } | null)?.pla);

  let payload: unknown;
  try {
    payload = JSON.parse(sampleJson);
  } catch {
    // A half-typed sample must not stop a run: the Manual trigger just starts with an empty object.
    payload = {};
  }

  return await startRun({
    orgId,
    workflowId: workflowId as Id<"workflows">,
    trigger: { type: "manual", payload },
    startedBy: userId ?? undefined,
    planSlug,
  });
}

/** What Publish did, or why it did not. Serialized back to the canvas. */
export type PublishResult =
  | {
      ok: true;
      status: "active" | "paused";
      /** True when a schedule is now running for this workflow. */
      scheduled: boolean;
      /** When it next fires, if it is scheduled. */
      nextAt: number | null;
    }
  | { ok: false; code: string; error: string };

/**
 * Publish, as one switch.
 *
 * Publishing is what turns a trigger on, and a Schedule trigger's "on" is two things: the
 * workflow's `status`, and a durable scheduler run sleeping until the next occurrence. Before this
 * action they were two separate controls, so a user could publish an hourly workflow and watch
 * nothing happen — the `schedules` table stayed empty because nobody had also flipped a second
 * switch. Now one press does both, in this order:
 *
 * - **Publishing** enables the schedule *first*. If the plan refuses the interval, the workflow is
 *   left unpublished and the message says why — the alternative is a published workflow that
 *   silently never fires, which is the bug this action exists to remove. A schedule enabled a beat
 *   before the status flips cannot fire early: `fireSchedule` skips a workflow that is not `active`.
 * - **Unpublishing** writes the status *first*, because that alone already stops every trigger
 *   including the scheduler, and then pauses the schedule best-effort. A store that is briefly
 *   unreachable must never be the reason a workflow stays live.
 *
 * Publishing a graph with no Schedule trigger pauses any schedule left over from one, so a row
 * belonging to a trigger the user has since replaced cannot fire the graph that replaced it.
 *
 * Nothing is trusted from the client: `workflowId` is checked against the caller's org inside
 * Convex, and what gets scheduled is the *saved* graph rather than anything the canvas sent.
 */
export async function publishWorkflow(
  workflowId: string,
  publish: boolean,
): Promise<PublishResult> {
  const { isAuthenticated, orgId, userId, sessionClaims, has } = await auth();
  if (!isAuthenticated || !orgId) throw new Error("unauthorized");

  const workflow = await getWorkflowForRun(workflowId as Id<"workflows">, orgId);
  if (!workflow) return { ok: false, code: "not_found", error: "No such workflow." };

  const decision = publishDecision({
    publish,
    scheduleTrigger: hasScheduleTrigger(workflow.graph),
  });

  if (decision.schedule === "enable") {
    const plan = schedulePlan({
      plan: planFromClaim((sessionClaims as { pla?: unknown } | null)?.pla),
      // The feature lifts the interval floor; without it the org's own plan sets it.
      entitled: has({ feature: `org:${SCHEDULES_FEATURE}` }),
    });

    const scheduled = await enableSchedule({
      workflowId,
      orgId,
      userId: userId ?? undefined,
      plan,
      workflow,
    });
    if (!scheduled.ok) return { ok: false, code: scheduled.code, error: scheduled.error };

    await setWorkflowStatus({ workflowId, orgId, status: decision.status });
    return { ok: true, status: decision.status, scheduled: true, nextAt: scheduled.nextAt };
  }

  await setWorkflowStatus({ workflowId, orgId, status: decision.status });

  // Best effort, and deliberately after the status: the workflow is already off the air, so a
  // schedule that could not be paused is a sleeping run that will find `status !== "active"` on its
  // next tick and skip, not a workflow that keeps running.
  const paused = await pauseSchedule({ workflowId, orgId });
  if (!paused.ok) {
    console.warn("publishWorkflow: could not pause the schedule", {
      workflowId,
      orgId,
      code: paused.code,
    });
  }

  return { ok: true, status: decision.status, scheduled: false, nextAt: null };
}
