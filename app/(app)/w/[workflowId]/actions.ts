"use server";

import { auth } from "@clerk/nextjs/server";

import type { Id } from "@/convex/_generated/dataModel";
import { startRun } from "@/lib/engine-client";
import { DEFAULT_PLAN, isPlanSlug, type PlanSlug } from "@/lib/plans";

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
  const planSlug = planFromClaim(sessionClaims);

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

/** `pla` is "<scope>:<slug>", e.g. "o:pro"; anything unrecognised is the free plan. */
function planFromClaim(sessionClaims: unknown): PlanSlug {
  const pla = (sessionClaims as { pla?: unknown } | null | undefined)?.pla;
  if (typeof pla !== "string") return DEFAULT_PLAN;

  const slug = pla.replace(/^o:/, "");
  return isPlanSlug(slug) ? slug : DEFAULT_PLAN;
}
