import { always } from "eve/tools/approval";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { removeNode } from "../lib/edits";
import { requireBuilder } from "../lib/session";

/**
 * Deletes a node and every edge touching it.
 *
 * The only Builder tool that destroys something a person may have drawn by hand, so it is the only
 * one with `approval: always()` (`eve/tools/approval`): the call is shown to the user and does not
 * run until they say yes. Approval gates the call *before* `execute`; `ask()` inside a durable tool
 * is the other half of the same idea (`node_modules/eve/docs/tools/workflows.mdx`).
 */
export default defineTool({
  description: "Remove one node from the workflow, along with every edge connected to it.",
  inputSchema: z.object({
    node: z.string().describe("The node's template key (or id)."),
    reason: z.string().optional().describe("Why it should go — shown to the user with the request."),
  }),
  approval: always(),
  async execute({ node }, ctx) {
    const session = await requireBuilder(ctx);
    return await removeNode(session, node);
  },
});
