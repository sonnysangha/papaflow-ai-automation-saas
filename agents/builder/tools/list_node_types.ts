import { defineTool } from "eve/tools";
import { z } from "zod";

import { catalogue } from "../lib/edits";
import { requireBuilder } from "../lib/session";

/**
 * What PapaFlow can do, from the node registry itself — so a node added to `nodes/registry.ts`
 * is a node the Builder can use the same day, with no prompt to update.
 *
 * Two depths on purpose: no arguments gives one line per node (twenty-eight JSON Schemas at once
 * would be most of a context window spent before anything is decided), `types` gives the full
 * input and output schemas for the few the plan actually needs.
 */
export default defineTool({
  description:
    "List the node types this workflow can use. Call it with no arguments to browse, then again " +
    "with `types` to get the full input schema of the nodes you picked before configuring them.",
  inputSchema: z.object({
    category: z
      .enum(["trigger", "logic", "ai", "chat", "data", "action"])
      .optional()
      .describe("Only list nodes in this category."),
    types: z
      .array(z.string())
      .optional()
      .describe("Return the full input/output JSON Schema for these node types."),
  }),
  async execute({ category, types }, ctx) {
    const session = await requireBuilder(ctx);
    return catalogue(session.features, { category, types });
  },
});
