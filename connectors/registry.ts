import { anthropicConnector } from "./anthropic";
import { deepseekConnector } from "./deepseek";
import type { ConnectorDef, FieldSpec } from "./define";
import { elevenlabsConnector } from "./elevenlabs";
import { falConnector } from "./fal";
import { googleConnector } from "./google";
import { groqConnector } from "./groq";
import { mistralConnector } from "./mistral";
import { openaiConnector } from "./openai";
import { openrouterConnector } from "./openrouter";
import { xaiConnector } from "./xai";

/** Adding a provider = one file here + one line in this array. */
const DEFINITIONS: readonly ConnectorDef[] = [
  openaiConnector,
  anthropicConnector,
  googleConnector,
  xaiConnector,
  mistralConnector,
  groqConnector,
  deepseekConnector,
  openrouterConnector,
  elevenlabsConnector,
  falConnector,
];

export function buildConnectorRegistry(definitions: readonly ConnectorDef[]): Record<string, ConnectorDef> {
  const registry: Record<string, ConnectorDef> = {};
  for (const definition of definitions) {
    if (registry[definition.provider]) {
      throw new Error(`Duplicate connector provider in registry: ${definition.provider}`);
    }
    registry[definition.provider] = definition;
  }
  return registry;
}

/** Throws at module load if two definitions share a `provider`. */
export const CONNECTORS: Record<string, ConnectorDef> = buildConnectorRegistry(DEFINITIONS);

type ConnectorCategory = ConnectorDef["category"];

const CATEGORY_ORDER: readonly ConnectorCategory[] = ["ai", "chat", "data", "email", "payments"];

export interface ConnectorCatalogueEntry {
  provider: string;
  name: string;
  category: ConnectorCategory;
  kind: ConnectorDef["kind"];
  icon: string;
  docsUrl: string;
  fields: FieldSpec[];
  requiresFeature: string | null;
  /** Whether the org's plan features cover this connector. */
  allowed: boolean;
}

/**
 * What the "Add connection" dialog renders. `features` are the org's Clerk feature slugs (see
 * `lib/plans.ts`); a connector the plan does not cover is still listed so the UI can dim it
 * and offer an upgrade — the real refusal happens again in `/api/connections`.
 *
 * Deliberately data-only: `test`/`pick`/`afterCreate` stay on the server. This value crosses
 * the wire to a client component, so it must survive `JSON.stringify` unchanged.
 */
export function connectorCatalogue(features: readonly string[]): ConnectorCatalogueEntry[] {
  return Object.values(CONNECTORS)
    .map((definition) => ({
      provider: definition.provider,
      name: definition.name,
      category: definition.category,
      kind: definition.kind,
      icon: definition.icon,
      docsUrl: definition.docsUrl,
      fields: definition.fields.map((field) => ({ ...field })),
      requiresFeature: definition.requiresFeature,
      allowed: !definition.requiresFeature || features.includes(definition.requiresFeature),
    }))
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.name.localeCompare(b.name),
    );
}

/** The only part of a secret that may ever be stored or shown: its last four characters. */
export function hintFor(secret: string): string {
  return secret.slice(-4);
}
