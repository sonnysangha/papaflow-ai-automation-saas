// One AI SDK provider instance per connection, built from the org's own key (CLAUDE.md rule 1:
// bring-your-own-key, opened inside the step and never stored on a module).
//
// Every factory name below is the v7 one, verified against the installed packages' `dist/index.d.ts`
// (`createGoogle`, not `createGoogleGenerativeAI`; `createDeepSeek`, not `createDeepseek`;
// `createOpenRouter` from `@openrouter/ai-sdk-provider`). The AI nodes only ever call these through
// `modelFor`, so a new provider is one `case` here plus a connector file.
import type { LanguageModel } from "ai";
// Provider packages are loaded lazily inside providerFor(): node definitions are imported by the
// canvas (client bundle) for their schemas, and a static import here would drag every @ai-sdk/*
// package into the browser. Steps run in Node, where the dynamic import resolves normally.

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

/**
 * The non-secret extras a provider needs alongside the key, carried on the connection.
 *
 * Anthropic is the only one today: a key that is not scoped to a single workspace must name the
 * workspace it acts in on every request (`anthropic-workspace-id`), or the API answers 400. The
 * connector captures it when the key is tested, so a connection that worked then keeps working.
 */
export type ProviderOptions = { workspaceId?: string };

export function isTextProvider(provider: string): provider is TextProvider {
  return (TEXT_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * The provider factory for a connection's `provider`, holding that org's key.
 *
 * A key must never end up in a module-level singleton: this is called per node run, inside the
 * step, with the secret `vault.openFresh()` just opened.
 */
export async function providerFor(
  provider: string,
  apiKey: string,
  options: ProviderOptions = {},
): Promise<ModelFactory> {
  switch (provider) {
    case "openai":
      return (await import("@ai-sdk/openai")).createOpenAI({ apiKey });
    case "anthropic":
      return (await import("@ai-sdk/anthropic")).createAnthropic({
        apiKey,
        // Absent unless the connection carries one: sending an empty or wrong workspace is itself
        // a 400, and a workspace-scoped key must not name a workspace at all.
        ...(options.workspaceId ? { headers: { "anthropic-workspace-id": options.workspaceId } } : {}),
      });
    case "google":
      return (await import("@ai-sdk/google")).createGoogle({ apiKey });
    case "xai":
      return (await import("@ai-sdk/xai")).createXai({ apiKey });
    case "mistral":
      return (await import("@ai-sdk/mistral")).createMistral({ apiKey });
    case "groq":
      return (await import("@ai-sdk/groq")).createGroq({ apiKey });
    case "deepseek":
      return (await import("@ai-sdk/deepseek")).createDeepSeek({ apiKey });
    case "openrouter":
      return (await import("@openrouter/ai-sdk-provider")).createOpenRouter({ apiKey });
    default:
      // A user's connection pointing at a provider with no text model (ElevenLabs, fal) is a
      // configuration mistake, not a transient failure: 400 so `runNode` refuses to retry it.
      throw new ConnectorError(`No text model provider for connection type "${provider}"`, 400);
  }
}

/** `providerFor(provider, apiKey)(modelId)` — the only shape the AI nodes need. */
export async function modelFor(
  provider: string,
  apiKey: string,
  modelId: string,
  options: ProviderOptions = {},
): Promise<LanguageModel> {
  return (await providerFor(provider, apiKey, options))(modelId);
}

/**
 * The opened connection an `ai.*` node runs on. `runNode` builds `credential` as
 * `{ provider, kind, ...secret }`, so the provider slug travels with the key and the node never has
 * to guess which vendor the model id belongs to.
 */
export function aiCredential(credential: Record<string, unknown> | undefined): {
  provider: string;
  apiKey: string;
  /** Pass straight to `modelFor`; empty for every provider that needs nothing extra. */
  options: ProviderOptions;
} {
  const provider = credential?.provider;
  const apiKey = credential?.apiKey;

  if (typeof provider !== "string" || typeof apiKey !== "string" || !apiKey) {
    throw new ConnectorError("This node needs an AI connection with an API key", 400);
  }

  return { provider, apiKey, options: providerOptions(credential) };
}

/**
 * The provider extras on an opened connection, from either place they can live: a field the user
 * typed (sealed with the key, so `credential.workspaceId`) or one the connector captured while
 * testing (`credential.meta.workspaceId`).
 */
function providerOptions(credential: Record<string, unknown>): ProviderOptions {
  const meta = credential.meta;
  const fromMeta =
    typeof meta === "object" && meta !== null
      ? (meta as Record<string, unknown>).workspaceId
      : undefined;
  const workspaceId = credential.workspaceId ?? fromMeta;

  return typeof workspaceId === "string" && workspaceId.trim().length > 0
    ? { workspaceId: workspaceId.trim() }
    : {};
}
