import { defineTool } from "eve/tools";
import { z } from "zod";

import { configureNode } from "../lib/edits";
import { requireBuilder } from "../lib/session";

/**
 * Fills in one node's configuration. A merge, not a replacement: fields the call does not mention
 * keep their values, so the connection set on one call survives the next.
 *
 * The inputs are checked against the node's own zod schema before they are written, with
 * `{{ templates }}` allowed to stand where the schema wants any type — the engine resolves them
 * before it parses (`nodes/templates.ts`). `needs` in the result lists what is still unset.
 */
export default defineTool({
  description:
    "Set configuration on one node. Values may be literals or {{ node_key.field }} templates " +
    "referring to an upstream node's output. Returns what the node still needs.",
  inputSchema: z.object({
    node: z.string().describe("The node's template key (or id)."),
    inputs: z.record(z.string(), z.any()).describe("Fields to set, merged into what is there."),
    label: z.string().optional().describe("Rename the node on the canvas."),
  }),
  async execute(args, ctx) {
    const session = await requireBuilder(ctx);
    return await configureNode(session, args);
  },
});
