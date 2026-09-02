/**
 * Which of an organisation's AI connections the Builder should think with, and which model on it.
 *
 * Kept out of `agent.ts` so the ranking is a pure function with a unit test rather than something
 * only a live session can exercise, and out of `tools/` because every file under `tools/` is
 * registered as a tool (the same reason `agents/runtime/lib/connector-tools.ts` exists).
 *
 * Model **ids** are never hardcoded (CLAUDE.md rule 11): they come from the list the connector
 * captured into `connection.meta.models` at connect time. `prefer` entries are lowercase
 * substrings, matched in order.
 */

export type ProviderPreference = { provider: string; prefer: readonly string[] };

/**
 * Providers in "most capable first" order. Planning a graph is the hardest thing PapaFlow asks of
 * a model — it holds a node catalogue, a half-built graph and a template language at once — so
 * this is not the cheapest-first order the house model is chosen by.
 */
export const PREFERRED_PROVIDERS: readonly ProviderPreference[] = [
  { provider: "anthropic", prefer: ["opus", "sonnet"] },
  { provider: "openai", prefer: ["gpt-5", "gpt-4.1", "gpt-4o"] },
  { provider: "google", prefer: ["pro"] },
  { provider: "xai", prefer: ["grok-4", "grok-3"] },
  { provider: "openrouter", prefer: ["opus", "sonnet", "gpt-5"] },
  { provider: "mistral", prefer: ["large"] },
  { provider: "groq", prefer: ["70b", "large"] },
  { provider: "deepseek", prefer: ["reasoner", "chat"] },
];

/** The model ids a connection reported when it was created, in the provider's own order. */
export function modelsFromMeta(meta: Record<string, unknown> | undefined): string[] {
  const models = meta?.models;
  if (!Array.isArray(models)) return [];
  return models.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/** The best available id: the first `prefer` substring that matches, else the provider's first. */
export function pickModelId(models: readonly string[], prefer: readonly string[]): string | null {
  if (models.length === 0) return null;
  for (const wanted of prefer) {
    const match = models.find((id) => id.toLowerCase().includes(wanted));
    if (match) return match;
  }
  return models[0];
}

/** The first preferred provider this organisation has an active connection for. */
export function pickConnection<T extends { provider: string; status: string }>(
  connections: readonly T[],
): { connection: T; preference: ProviderPreference } | null {
  for (const preference of PREFERRED_PROVIDERS) {
    const connection = connections.find(
      (entry) => entry.provider === preference.provider && entry.status === "active",
    );
    if (connection) return { connection, preference };
  }
  return null;
}
