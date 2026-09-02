import { z } from "zod";
import { defineNode } from "../define";

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
      .describe("Sample JSON payload used when you press Run"),
  }),
  outputs: z.object({ payload: z.any() }),
  async run({ inputs }) {
    let payload: unknown;
    try {
      payload = JSON.parse(inputs.sample);
    } catch {
      payload = {};
    }
    return { payload };
  },
});
