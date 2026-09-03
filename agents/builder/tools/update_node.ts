import { defineTool } from "eve/tools";
import { z } from "zod";

import { updateNode } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * A node's name and where it sits — the tidying-up half, kept apart from `configure_node`.
 *
 * `position` is not in any node's input schema: it is React Flow's, and every node the Builder adds
 * lands in one long row to the right of the last one. Once a Condition forks, moving the two
 * branches apart is the difference between a canvas someone can read and a canvas they redraw by
 * hand. `label` is the same field `configure_node` can rename through, offered here so renaming
 * does not require sending inputs.
 */
export default defineTool({
  description:
    "Rename a node or move it on the canvas. Use it to lay out a branch (nodes are added in one " +
    "row) or to give a node a clearer name. Does not change configuration.",
  inputSchema: z.object({
    node: z.string().min(1).describe("The node's template key (or id)."),
    label: z.string().min(1).optional().describe("What the node is called on the canvas."),
    position: z
      .object({ x: z.number(), y: z.number() })
      .optional()
      .describe("Canvas coordinates. Columns are ~280 apart, rows ~160."),
  }),
  async execute(args, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await updateNode(session, args);
    });
  },
});
