import { defineTool } from "eve/tools";
import { z } from "zod";

import { runReport } from "../lib/runs";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * One run, step by step: what each node was given, what it returned, how long it took, and — the
 * field that answers most "it ran but nothing happened" questions — `warnings`, the templates that
 * resolved to nothing.
 *
 * Values are trimmed to about 2 KB each and marked where they were cut, loop passes are numbered,
 * and a row a node spawned (an Agent node's tool call) names its parent under `childOf`.
 *
 * Secret-free by construction and again by hand: `steps.input` was redacted by the engine before
 * Convex stored it, no step ever carries a credential, and `trimValue` re-runs the same key-based
 * redaction on the way out (CLAUDE.md rule 1).
 */
export default defineTool({
  description:
    "Read one run's steps in order: status, duration, error, warnings (templates that resolved to " +
    "nothing) and the trimmed input and output of each node. This is how you debug a run that " +
    "failed or wrote empty data.",
  inputSchema: z.object({
    runId: z.string().min(1).describe("A run id from list_runs or run_workflow."),
  }),
  async execute({ runId }, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      const report = await runReport(session, runId);
      if (!report) {
        throw new Error(
          `There is no run "${runId}" for this workflow. Call list_runs to see the ids.`,
        );
      }
      return report;
    });
  },
});
