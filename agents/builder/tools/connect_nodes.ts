import { defineTool } from "eve/tools";
import { z } from "zod";

import { connectNodes } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * Draws one edge. `sourceHandle` is what makes a Condition a fork: the handles a node offers are in
 * its catalogue entry (`"true"`/`"false"` for Condition, one per case plus `"default"` for Switch,
 * `"each"`/`"done"` for Loop), and anything else is refused before Convex sees it.
 */
export default defineTool({
  description:
    "Connect one node's output to another node's input. Use `sourceHandle` to leave a specific " +
    "branch of a Condition, Switch or Loop; omit it for a node with a single output.",
  inputSchema: z.object({
    from: z.string().describe("The upstream node's template key (or id)."),
    to: z.string().describe("The downstream node's template key (or id)."),
    sourceHandle: z
      .string()
      .optional()
      .describe('The branch to leave by, e.g. "true", "false", "each", "done", or a Switch case.'),
  }),
  async execute(args, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await connectNodes(session, args);
    });
  },
});
