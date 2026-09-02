import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

import { getStepById, getStepByHookToken } from "@/lib/engine-client";
import { hookTokenFor, type HookPayload } from "@/workflows/types";

/**
 * The resume half of the hook plumbing: everything that turns a token in a URL back into a running
 * workflow.
 *
 * It lives in `lib/` rather than in `workflows/` because `resumeHook` may only be called from
 * outside workflow code — a route handler or a `"use step"` (CLAUDE.md rule 4). `runGraph` opens
 * the hook (`createHook({ token })`); this is the other end of the same token.
 *
 * The token is the whole authorization, exactly like the Webhook trigger's secret in its URL: it
 * is unguessable, it addresses one node of one run, and it stops working the moment that node
 * stops waiting.
 */

/** What a resume route answers with: 404 for "nothing is waiting here", the ids otherwise. */
export type ResumeResult =
  | { ok: true; executionId: string; nodeId: string; nodeType: string; orgId: string }
  | { ok: false; status: 404 };

const NOT_WAITING: ResumeResult = { ok: false, status: 404 };

/**
 * Resumes the run suspended on `token` with `payload`, which becomes that node's output.
 *
 * The Convex lookup comes first so the common refusals — a token that was never issued, a run that
 * has already moved on, a step that failed instead of waiting — are one indexed read rather than a
 * round trip into the Workflow SDK. `HookNotFoundError` then covers the race the lookup cannot:
 * the step row says `waiting` but the run has since ended, been cancelled, or was already resumed
 * by a second click on the same button. Both answer 404 — a caller holding a token must not be
 * able to tell "wrong token" from "too late".
 *
 * Every other error is rethrown: a Convex outage or a failed queue dispatch is a 502 for the route
 * to report, not a quiet "nothing was waiting".
 */
export async function resumeByToken(token: string, payload: HookPayload): Promise<ResumeResult> {
  const step = await getStepByHookToken(token);
  if (!step || step.status !== "waiting") return NOT_WAITING;

  return await resume(token, payload, step);
}

/**
 * The same resume, addressed by the step row's own Convex id instead of by the token.
 *
 * This is what an Approval button carries. A hook token is `${executionId}:${nodeId}[:${iteration}]`
 * — unbounded, and Telegram caps `callback_data` at 64 bytes — so the button carries `approve:<id>`
 * and the token is derived here from the ids on the row (or read straight off it: `runNode` stored
 * the same string when it suspended).
 *
 * `orgId` is not optional. A row id is not a secret and the caller has only proved that *some*
 * Slack workspace, Discord app or Telegram bot signed the delivery — so the run it names must
 * belong to the same organisation as the connection it arrived on, or it does not exist as far as
 * this route is concerned.
 */
export async function resumeByStepId(
  stepId: string,
  payload: HookPayload,
  orgId: string,
): Promise<ResumeResult> {
  const step = await getStepById(stepId).catch((cause: unknown) => {
    // An id that is not even shaped like one is an argument-validation error from Convex, which is
    // the same answer as an id nobody issued.
    console.warn("hooks: unusable step id", cause instanceof Error ? cause.message : cause);
    return null;
  });

  if (!step || step.status !== "waiting" || step.orgId !== orgId) return NOT_WAITING;

  const token = step.hookToken ?? hookTokenFor(step.executionId, step.nodeId, step.iteration);
  return await resume(token, payload, step);
}

/** The half both entry points share: hand the payload to the SDK, map its refusal onto a 404. */
async function resume(
  token: string,
  payload: HookPayload,
  step: { executionId: string; nodeId: string; nodeType: string; orgId: string },
): Promise<ResumeResult> {
  try {
    await resumeHook<HookPayload>(token, payload);
  } catch (error) {
    // `.is()` rather than `instanceof`: the SDK's errors cross module and VM boundaries.
    if (HookNotFoundError.is(error)) return NOT_WAITING;
    throw error;
  }

  return {
    ok: true,
    executionId: step.executionId,
    nodeId: step.nodeId,
    nodeType: step.nodeType,
    orgId: step.orgId,
  };
}
