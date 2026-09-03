import { defineTool } from "eve/tools";
import { z } from "zod";

import { setTriggerSample } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * The payload the Run button starts this workflow with.
 *
 * It matters more than it looks. `{{ trigger.name }}` only resolves to something if the run
 * actually carried a `name`, and a manual run with an empty payload falls back to this sample
 * (`lib/engine-client.ts#withTriggerSample`). Setting it is therefore how the Builder makes its own
 * templates testable — and how it stops writing templates against keys that were never going to
 * exist.
 *
 * Stored as the Manual trigger's `sample` input, so the canvas shows exactly the same JSON in the
 * node's panel.
 */
export default defineTool({
  description:
    "Set the sample JSON the Manual trigger starts with, so {{ trigger.<key> }} templates resolve " +
    "when you press Run. Set it before writing templates against the trigger, and use only the " +
    "keys it contains.",
  inputSchema: z.object({
    sample: z
      .record(z.string(), z.any())
      .describe("The trigger payload, as an object. Its keys are what {{ trigger.… }} can read."),
  }),
  async execute({ sample }, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await setTriggerSample(session, sample);
    });
  },
});
