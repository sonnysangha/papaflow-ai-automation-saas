import { z } from "zod";

import { MODELS_PICKER } from "@/connectors/define";
import { aiCredential, modelFor } from "@/lib/ai/providers";
import { defineNode } from "../define";

/** The four field types the config form offers, mapped onto the zod they generate. */
const FIELD_TYPES = ["string", "number", "boolean", "string[]"] as const;

type FieldType = (typeof FIELD_TYPES)[number];

function zodFor(type: FieldType): z.ZodType {
  switch (type) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "string[]":
      return z.array(z.string());
    default:
      return z.string();
  }
}

/**
 * Structured extraction: the user names the fields, the node builds the schema.
 *
 * v7 has no `generateObject` worth using — it is exported but deprecated — so this is
 * `generateText({ output: Output.object({ schema }) })` and the value comes back on `result.output`
 * (CLAUDE.md rule 9). Field names are identifier-shaped because they become both JSON Schema
 * property names and template paths (`{{ ai_extract_1.total }}`).
 */
export const extractNode = defineNode({
  type: "ai.extract",
  name: "Extract",
  description: "Pull named fields out of text as structured JSON.",
  category: "ai",
  icon: "ScanText",
  credential: "ai",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    model: z.string().meta({ picker: MODELS_PICKER, label: "Model" }),
    prompt: z.string(),
    fields: z
      .array(
        z.object({
          name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
          type: z.enum(FIELD_TYPES),
          description: z.string().optional(),
        }),
      )
      .min(1),
  }),
  outputs: z.record(z.string(), z.any()),
  async run({ inputs, credential }) {
    const { provider, apiKey, options } = aiCredential(credential);

    const shape: Record<string, z.ZodType> = {};
    for (const field of inputs.fields) {
      const base = zodFor(field.type);
      // The description is the only instruction the model gets about a field, so it is worth passing.
      shape[field.name] = field.description ? base.describe(field.description) : base;
    }

    const { generateText, Output } = await import("ai"); // lazy: keeps the ai package out of the client bundle
    const result = await generateText({
      model: await modelFor(provider, apiKey, inputs.model, options),
      prompt: inputs.prompt,
      output: Output.object({ schema: z.object(shape) }),
    });

    return result.output;
  },
});
