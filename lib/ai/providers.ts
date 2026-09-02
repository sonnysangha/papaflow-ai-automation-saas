// One AI SDK provider instance per connection, built from the org's own key (CLAUDE.md rule 1:
// bring-your-own-key, opened inside the step and never stored on a module).
//
// Every factory name below is the v7 one, verified against the installed packages' `dist/index.d.ts`
// (`createGoogle`, not `createGoogleGenerativeAI`; `createDeepSeek`, not `createDeepseek`;
// `createOpenRouter` from `@openrouter/ai-sdk-provider`). The AI nodes only ever call these through
// `modelFor`, so a new provider is one `case` here plus a connector file.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

import { ConnectorError } from "@/nodes/define";

/** The providers whose connections can drive an `ai.*` node. */
export const TEXT_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "groq",
  "deepseek",
  "openrouter",
] as const;

export type TextProvider = (typeof TEXT_PROVIDERS)[number];

/**
 * A provider instance as the nodes use it: call it with a model id and hand the result to
 * `generateText`. The concrete factories return richer objects (`.chat()`, `.textEmbeddingModel()`,
 * …); erasing them to one callable is what lets a single `switch` return all eight.
 */
export type ModelFactory = (modelId: string) => LanguageModel;

export function isTextProvider(provider: string): provider is TextProvider {
  return (TEXT_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * The provider factory for a connection's `provider`, holding that org's key.
 *
 * A key must never end up in a module-level singleton: this is called per node run, inside the
 * step, with the secret `vault.openFresh()` just opened.
 */
export function providerFor(provider: string, apiKey: string): ModelFactory {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey });
    case "anthropic":
      return createAnthropic({ apiKey });
    case "google":
      return createGoogle({ apiKey });
    case "xai":
      return createXai({ apiKey });
    case "mistral":
      return createMistral({ apiKey });
    case "groq":
      return createGroq({ apiKey });
    case "deepseek":
      return createDeepSeek({ apiKey });
    case "openrouter":
      return createOpenRouter({ apiKey });
    default:
      // A user's connection pointing at a provider with no text model (ElevenLabs, fal) is a
      // configuration mistake, not a transient failure: 400 so `runNode` refuses to retry it.
      throw new ConnectorError(`No text model provider for connection type "${provider}"`, 400);
  }
}

/** `providerFor(provider, apiKey)(modelId)` — the only shape the AI nodes need. */
export function modelFor(provider: string, apiKey: string, modelId: string): LanguageModel {
  return providerFor(provider, apiKey)(modelId);
}

/**
 * The opened connection an `ai.*` node runs on. `runNode` builds `credential` as
 * `{ provider, kind, ...secret }`, so the provider slug travels with the key and the node never has
 * to guess which vendor the model id belongs to.
 */
export function aiCredential(credential: Record<string, unknown> | undefined): {
  provider: string;
  apiKey: string;
} {
  const provider = credential?.provider;
  const apiKey = credential?.apiKey;

  if (typeof provider !== "string" || typeof apiKey !== "string" || !apiKey) {
    throw new ConnectorError("This node needs an AI connection with an API key", 400);
  }

  return { provider, apiKey };
}
