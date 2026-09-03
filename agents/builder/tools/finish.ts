import { defineTool } from "eve/tools";
import { z } from "zod";

import { finish } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * The last call of a build: the workflow becomes `active` and the user is told how to set it off.
 *
 * A webhook trigger's URL is not returned — it carries the workflow's `webhookSecret`, and a secret
 * must never reach the model (CLAUDE.md rule 1). The user copies it from the node's own panel.
 */
export default defineTool({
  description:
    "Mark the workflow active and summarise it for the user. Call validate_workflow first and fix " +
    "every problem it reports; this is the last thing you do.",
  inputSchema: z.object({
    summary: z.string().describe("Two or three sentences: what the workflow does, in plain words."),
  }),
  async execute({ summary }, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await finish(session, summary);
    });
  },
});
