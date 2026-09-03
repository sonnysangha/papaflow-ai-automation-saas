import { defineTool } from "eve/tools";
import { z } from "zod";

import { addNode } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * Places one node on the canvas the user is looking at.
 *
 * One node per call, deliberately: the panel and the canvas share a live Convex subscription, so
 * each call is a node appearing in front of the user. A tool that took an array would draw the
 * whole workflow in one flash and lose the thing that makes this worth watching.
 *
 * The node is placed to the right of everything already there. Inputs are optional — configure the
 * node afterwards, once you know the connection id or the upstream node's template key.
 */
export default defineTool({
  description:
    "Add one node to the workflow. Returns the node's template key, which is how you refer to it " +
    "in later calls and in {{ templates }}. Add nodes one at a time, in the order they run.",
  inputSchema: z.object({
    type: z.string().describe('A node type from list_node_types, e.g. "http.request".'),
    label: z.string().optional().describe("What the node is called on the canvas."),
    inputs: z
      .record(z.string(), z.any())
      .optional()
      .describe("Initial configuration, as in the node's input schema. May be filled in later."),
  }),
  async execute(args, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await addNode(session, args);
    });
  },
});
