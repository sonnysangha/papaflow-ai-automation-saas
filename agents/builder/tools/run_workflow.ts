import { defineTool } from "eve/tools";
import { z } from "zod";

import { MAX_WAIT_SECONDS, startManualRun, waitForRun } from "../lib/runs";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * Presses Run, then reads what happened.
 *
 * The run goes through `POST /api/engine/run` in the Next app rather than `start()` here, because a
 * workflow function only exists once the Workflow SDK's compiler has transformed it and that
 * transform belongs to the Next build, not to this agent's Vercel service (see the long note in
 * `../lib/runs.ts`). The route calls the same `startRun` the Run button's server action calls, with
 * the same Clerk plan snapshot, the same monthly quota check and the same trigger-sample fallback —
 * so a run started from the chat is indistinguishable from one the user started.
 *
 * `wait` is on by default because the point of the tool is the answer, not the id: it polls until
 * the run settles or the deadline passes, then hands back the same report `get_run` would. A run
 * that is still going when the wait ends comes back with `stillRunning: true` and its id.
 */
export default defineTool({
  description:
    "Run this workflow now with a manual trigger and report what each step did. Use it to test " +
    "what you built: read the result, fix whatever failed or resolved to nothing, and run it " +
    "again. Waits for the run to finish by default.",
  inputSchema: z.object({
    payload: z
      .record(z.string(), z.any())
      .optional()
      .describe(
        "The trigger payload for this run, as an object. Omit to use the Manual trigger's saved " +
          "sample. Templates read it as {{ trigger.<key> }}.",
      ),
    wait: z.boolean().optional().describe("Wait for the run to finish. Defaults to true."),
    waitSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_WAIT_SECONDS)
      .optional()
      .describe(`How long to wait, in seconds. Defaults to 30, at most ${MAX_WAIT_SECONDS}.`),
  }),
  async execute({ payload, wait, waitSeconds }, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      const { runId } = await startManualRun(session, payload);

      if (wait === false) {
        return {
          started: true,
          runId,
          note: "Call get_run with this id once it has had a moment to finish.",
        };
      }

      const report = await waitForRun(session, runId, waitSeconds ?? 30);
      return (
        report ?? {
          started: true,
          runId,
          note: "The run started but its row is not readable yet. Call get_run with this id.",
        }
      );
    });
  },
});
