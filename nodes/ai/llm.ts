import { z } from "zod";

import { MODELS_PICKER } from "@/connectors/define";
import { aiCredential, modelFor } from "@/lib/ai/providers";
import { defineNode } from "../define";

/**
 * The plain prompt node: one call, one string back.
 *
 * `connectionId` is an input like any other — the canvas fills it from the org's AI connections and
 * `runNode` swaps it for the opened key before `run` is ever called, so nothing here (and nothing in
 * the run log) holds a secret.
 *
 * Anthropic's 5-series rejects `temperature` / `top_p` / `top_k` with a 400 (CLAUDE.md rule 9), so
 * the field is offered in the UI but dropped for that provider rather than failing the run. Nothing
 * here forces a tool choice either, which the same models also refuse.
 */
export const llmNode = defineNode({
  type: "ai.llm",
  name: "LLM",
  description: "Prompt any connected model and return its text.",
  category: "ai",
  icon: "Sparkles",
  credential: "ai",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    model: z.string().meta({ picker: MODELS_PICKER, label: "Model" }),
    instructions: z.string().optional(),
    prompt: z.string().min(1),
    maxOutputTokens: z.number().int().positive().default(1024),
    temperature: z.number().min(0).max(2).optional(),
  }),
  outputs: z.object({
    text: z.string(),
    finishReason: z.string(),
    usage: z
      .object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
      .partial(),
  }),
  async run({ inputs, credential }) {
    const { provider, apiKey } = aiCredential(credential);

    const { generateText, Output } = await import("ai"); // lazy: keeps the ai package out of the client bundle
    const result = await generateText({
      model: await modelFor(provider, apiKey, inputs.model),
      instructions: inputs.instructions,
      prompt: inputs.prompt,
      maxOutputTokens: inputs.maxOutputTokens,
      ...(provider !== "anthropic" && inputs.temperature !== undefined
        ? { temperature: inputs.temperature }
        : {}),
    });

    return {
      text: result.text,
      finishReason: result.finishReason,
      // Only the two counters the runs drawer shows; the rest of `usage` is provider-specific.
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      },
    };
  },
});
