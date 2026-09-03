import { defineTool } from "eve/tools";
import { z } from "zod";

import { listRuns } from "../lib/runs";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * This workflow's recent runs, newest first — one line each, no step data.
 *
 * The cheap half of debugging: which run to look at. `get_run` is the expensive half, and asking
 * for it by id is what keeps a Builder turn from pulling twenty runs' worth of node output into a
 * context window.
 */
export default defineTool({
  description:
    "List this workflow's recent runs, newest first: run id, status, trigger, when it started, " +
    "how long it took and the error if it failed. Use get_run with an id to see the steps.",
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("How many runs to list. Defaults to 5."),
  }),
  async execute({ limit }, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return { runs: await listRuns(session, limit) };
    });
  },
});
