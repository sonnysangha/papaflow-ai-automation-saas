import { FatalError } from "workflow";

import { finishExecution, getStep, markStep, markSkipped } from "@/lib/engine-client";
import type { ExecutionStatus } from "@/convex/lib/validators";

/**
 * The bookkeeping steps: everything `runGraph` needs to write down that is not a node running.
 *
 * They exist as separate `"use step"` functions rather than calls inside the workflow body because
 * a `"use workflow"` function may not do I/O at all (CLAUDE.md rule 4) — and because each one gets
 * the SDK's retries, so a Convex hiccup at the end of a run does not lose the run's outcome.
 */

/** `skipped` rows for the branches the walk never reached, so the canvas can grey them out. */
export async function recordSkipped(
  executionId: string,
  orgId: string,
  nodeIds: string[],
): Promise<void> {
  "use step";

  if (nodeIds.length === 0) return;
  await markSkipped(executionId, orgId, nodeIds);
}

/** Closes the execution row. Called on both paths out of the workflow, including the failure one. */
export async function recordFinish(
  executionId: string,
  status: ExecutionStatus,
  error?: string,
): Promise<void> {
  "use step";

  await finishExecution(executionId, status, error);
}

/**
 * Closes a node that was `waiting` on a hook: the payload the hook received becomes the node's
 * output. `orgId`, `nodeType` and `attempt` come from the row `runNode` already wrote, so the
 * workflow does not have to carry them through the suspension.
 *
 * `handle` is the branch the resumed run is about to take — for an Approval that is decided by the
 * payload ("approved" or "rejected"), not by anything the node knew when it suspended — so the
 * step row records the branch that was actually followed rather than the one it guessed.
 */
export async function recordResume(
  executionId: string,
  nodeId: string,
  output: unknown,
  handle?: string | null,
  iteration?: number,
): Promise<void> {
  "use step";

  const stored = await getStep(executionId, nodeId, iteration);
  // The row is written before the workflow ever suspends, so its absence is a bug, not a race.
  if (!stored) throw new FatalError(`no step row to resume for node ${nodeId}`);

  await markStep({
    executionId,
    orgId: stored.orgId,
    nodeId,
    nodeType: stored.nodeType,
    status: "success",
    attempt: stored.attempt,
    output,
    handle: handle ?? stored.handle ?? undefined,
    iteration,
  });
}

/**
 * Closes a Loop with what its iterations actually produced.
 *
 * A Loop's `run` can only report how many items it found — the passes happen afterwards, in the
 * orchestrator, one body step at a time — so its step row is written twice: `{ results: [], count }`
 * when the node ran, and this once the body has finished. Downstream templates read the second one
 * (`{{ loop_1.results }}`), and the runs drawer shows a Loop that explains itself.
 */
export async function recordLoop(
  executionId: string,
  nodeId: string,
  output: { results: unknown[]; count: number },
): Promise<void> {
  "use step";

  const stored = await getStep(executionId, nodeId);
  if (!stored) throw new FatalError(`no step row to close for loop ${nodeId}`);

  await markStep({
    executionId,
    orgId: stored.orgId,
    nodeId,
    nodeType: stored.nodeType,
    status: "success",
    attempt: stored.attempt,
    output,
  });
}
