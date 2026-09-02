import { z } from "zod";
import { defineNode } from "../define";

/** Only an object can be the run's payload: templates address it by key (`{{ key.field }}`). */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The trigger behind the Run button. Its output *is* the sample object — not `{ payload }` — so a
 * downstream template reads `{{ manual_trigger_1.lead.email }}` rather than an extra `.payload`
 * hop, and `{{ trigger.lead.email }}` means exactly the same thing.
 *
 * Nothing calls this `run` during a real run: `startRun` writes the trigger's step row straight
 * from the payload the caller parsed (`app/(app)/w/[workflowId]/actions.ts`). It exists so the
 * node is complete on its own — same input, same output.
 */
export const manualTrigger = defineNode({
  type: "manual.trigger",
  name: "Manual trigger",
  description: "Starts the workflow when you press Run.",
  category: "trigger",
  icon: "Play",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    sample: z
      .string()
      .default("{}")
      .describe("Sample JSON payload used when you press Run")
      .meta({ label: "Sample payload (JSON)" }),
  }),
  outputs: z.record(z.string(), z.any()),
  async run({ inputs }) {
    try {
      return asObject(JSON.parse(inputs.sample));
    } catch {
      // Invalid JSON starts the run with an empty payload rather than failing before it began.
      return {};
    }
  },
});
