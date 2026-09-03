"use server";

import { auth } from "@clerk/nextjs/server";

import type { Id } from "@/convex/_generated/dataModel";
import { startRun } from "@/lib/engine-client";
import { planFromClaim } from "@/lib/plans";
import { applyPublish, type PublishResult } from "@/lib/publish-server";
import { SCHEDULES_FEATURE, schedulePlan } from "@/lib/schedules-server";

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
export type { PublishResult };

/**
 * Publish, as one switch.
 *
 * Publishing is what turns a trigger on, and a Schedule trigger's "on" is two things: the
 * workflow's `status`, and a durable scheduler run sleeping until the next occurrence. Before
 * `lib/publish-server.ts` they were two separate controls, so a user could publish an hourly
 * workflow and watch nothing happen — the `schedules` table stayed empty because nobody had also
 * flipped a second switch. One press now does both, and `applyPublish` is the only thing that
 * knows the order; the Builder's `finish` reaches the same function through
 * `POST /api/engine/publish`, so a workflow the agent finishes is scheduled exactly as one the user
 * published.
 *
 * All that is left here is the session: who is asking, and which plan their schedule is judged
 * against. Nothing is trusted from the client — `workflowId` is checked against the caller's org
 * inside Convex, and what gets scheduled is the *saved* graph rather than anything the canvas sent.
 */
export async function publishWorkflow(
  workflowId: string,
  publish: boolean,
): Promise<PublishResult> {
  const { isAuthenticated, orgId, userId, sessionClaims, has } = await auth();
  if (!isAuthenticated || !orgId) throw new Error("unauthorized");

  const plan = schedulePlan({
    plan: planFromClaim((sessionClaims as { pla?: unknown } | null)?.pla),
    // The feature lifts the interval floor; without it the org's own plan sets it.
    entitled: has({ feature: `org:${SCHEDULES_FEATURE}` }),
  });

  return await applyPublish({ workflowId, orgId, userId: userId ?? undefined, plan, publish });
}
