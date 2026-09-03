import type { Id } from "@/convex/_generated/dataModel";
import { getWorkflowForRun, setWorkflowStatus } from "@/lib/engine-client";
import {
  enableSchedule,
  hasScheduleTrigger,
  pauseSchedule,
  publishDecision,
  type ScheduleErrorCode,
} from "@/lib/schedules-server";

/**
 * Publish, as one function — the whole of what pressing Publish does, with nothing session-shaped
 * left in it.
 *
 * Two callers press the same button and must not be able to disagree about what it does:
 *
 * - the `publishWorkflow` server action (`app/(app)/w/[workflowId]/actions.ts`), which resolves the
 *   plan from the caller's Clerk session claims and the `schedules` feature;
 * - `POST /api/engine/publish`, which the Builder agent's `finish` tool calls over `ENGINE_SECRET`
 *   because it runs in a separate Vercel service and cannot call a server action. It has no
 *   session, so its plan comes from the Clerk Backend API (`getOrgPlan`).
 *
 * Before this module existed only the action knew that publishing a Schedule trigger also means
 * starting a durable scheduler run, so a workflow the Builder finished was published and never
 * scheduled — the exact bug `lib/schedules-server.ts` was written to remove, reintroduced through a
 * second door.
 *
 * No `"use server"` directive, deliberately: a server action file turns every export into a
 * client-callable endpoint, and the plan an org is judged against is an argument here.
 */

/** What publishing did, or why it did not. The action serializes this straight to the canvas. */
export type PublishResult =
  | {
      ok: true;
      status: "active" | "paused";
      /** True when a schedule is now running for this workflow. */
      scheduled: boolean;
      /** When it next fires, if it is scheduled. */
      nextAt: number | null;
    }
  | { ok: false; code: ScheduleErrorCode; error: string };

export type PublishInput = {
  workflowId: string;
  orgId: string;
  /** Who asked. Informational — it lands in the server log, never on the row. */
  userId?: string;
  /**
   * The plan slug a schedule's interval is judged against. The action resolves it with
   * `schedulePlan()` from the session claims; the route reads it from Clerk's Backend API.
   */
  plan: string;
  publish: boolean;
};

/**
 * Publishes a workflow, or takes it back off the air, and keeps its schedule agreeing.
 *
 * A Schedule trigger's "on" is two things: the workflow's `status`, and a durable scheduler run
 * sleeping until the next occurrence. They move in this order, and the order is the point:
 *
 * - **Publishing** enables the schedule *first*. If the plan refuses the interval, the workflow is
 *   left unpublished and the caller is told why — the alternative is a published workflow that
 *   silently never fires. A schedule enabled a beat before the status flips cannot fire early:
 *   `fireSchedule` skips a workflow that is not `active`.
 * - **Unpublishing** writes the status *first*, because that alone already stops every trigger
 *   including the scheduler, and then pauses the schedule best-effort. A store that is briefly
 *   unreachable must never be the reason a workflow stays live.
 *
 * Publishing a graph with no Schedule trigger pauses any schedule left over from one, so a row
 * belonging to a trigger the user has since replaced cannot fire the graph that replaced it.
 *
 * Nothing here trusts the caller's idea of the graph: `workflowId` is checked against `orgId`
 * inside Convex, and what gets scheduled is the *saved* graph.
 */
export async function applyPublish(input: PublishInput): Promise<PublishResult> {
  const { workflowId, orgId, userId, plan, publish } = input;

  const workflow = await getWorkflowForRun(workflowId as Id<"workflows">, orgId);
  if (!workflow) return { ok: false, code: "not_found", error: "No such workflow." };

  const decision = publishDecision({
    publish,
    scheduleTrigger: hasScheduleTrigger(workflow.graph),
  });

  if (decision.schedule === "enable") {
    const scheduled = await enableSchedule({ workflowId, orgId, userId, plan, workflow });
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
    console.warn("publish: could not pause the schedule", { workflowId, orgId, code: paused.code });
  }

  return { ok: true, status: decision.status, scheduled: false, nextAt: null };
}
