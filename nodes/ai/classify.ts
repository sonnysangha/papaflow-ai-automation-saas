import { z } from "zod";

import { MODELS_PICKER } from "@/connectors/define";
import { aiCredential, modelFor } from "@/lib/ai/providers";
import { defineNode } from "../define";

/**
 * One label out of a fixed list — the node a Condition or Switch branches on.
 *
 * `Output.choice({ options })` is the v7 way to constrain a generation to a set of strings; there is
 * no `Output.enum`. The model can only answer with one of the configured labels, so the output is
 * safe to compare against in the next node's condition.
 */
export const classifyNode = defineNode({
  type: "ai.classify",
  name: "Classify",
  description: "Sort text into one of the labels you list.",
  category: "ai",
  icon: "Tags",
  credential: "ai",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    model: z.string().meta({ picker: MODELS_PICKER, label: "Model" }),
    text: z.string(),
    labels: z.array(z.string().min(1)).min(2),
    instructions: z.string().optional(),
  }),
  outputs: z.object({ label: z.string() }),
  async run({ inputs, credential }) {
    const { provider, apiKey } = aiCredential(credential);

    const { generateText, Output } = await import("ai"); // lazy: keeps the ai package out of the client bundle
    const result = await generateText({
      model: await modelFor(provider, apiKey, inputs.model),
      instructions: inputs.instructions,
      prompt: inputs.text,
      output: Output.choice({ options: inputs.labels }),
    });

    return { label: result.output };
  },
});
