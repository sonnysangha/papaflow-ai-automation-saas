import { defineTool } from "eve/tools";
import { z } from "zod";

import { renameWorkflow } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * Names the workflow. Not a graph edit — the version does not move, so an open canvas has nothing
 * to adopt and the header simply updates from its own subscription.
 *
 * Worth doing exactly once, at the end: "Untitled workflow" is what every one of these starts as,
 * and the workflow list is unreadable when three of them share that name.
 */
export default defineTool({
  description:
    "Rename this workflow. Do it once, when the workflow is built and you know what it does. " +
    "Three or four words, no punctuation.",
  inputSchema: z.object({
    name: z.string().min(1).max(80).describe('What it does, e.g. "New leads to Airtable".'),
  }),
  async execute({ name }, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await renameWorkflow(session, name);
    });
  },
});
