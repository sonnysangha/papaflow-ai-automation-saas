import { emailSend } from "./actions/email-send";
import { httpRequest } from "./actions/http-request";
import { classifyNode } from "./ai/classify";
import { extractNode } from "./ai/extract";
import { llmNode } from "./ai/llm";
import { categoryOrder } from "./categories";
import type { AnyNodeDef, NodeCategory } from "./define";
import { conditionNode } from "./logic/condition";
import { setNode } from "./logic/set";
import { switchNode } from "./logic/switch";
import { toJsonSchema, type JsonSchema } from "./schema";
import { formTriggerNode } from "./triggers/form";
import { manualTrigger } from "./triggers/manual";
import { stripeEventTriggerNode } from "./triggers/stripe-event";
import { telegramMessageTriggerNode } from "./triggers/telegram-message";
import { webhookTriggerNode } from "./triggers/webhook";

/** Adding a connector = one file here + one line in this array. */
const DEFINITIONS: readonly AnyNodeDef[] = [
  manualTrigger,
  webhookTriggerNode,
  formTriggerNode,
  telegramMessageTriggerNode,
  stripeEventTriggerNode,
  conditionNode,
  switchNode,
  setNode,
  llmNode,
  extractNode,
  classifyNode,
  httpRequest,
  emailSend,
];

export function buildRegistry(definitions: readonly AnyNodeDef[]): Record<string, AnyNodeDef> {
  const registry: Record<string, AnyNodeDef> = {};
  for (const definition of definitions) {
    if (registry[definition.type]) {
      throw new Error(`Duplicate node type in registry: ${definition.type}`);
    }
    registry[definition.type] = definition;
  }
  return registry;
}

/** Throws at module load if two definitions share a `type`. */
export const NODES: Record<string, AnyNodeDef> = buildRegistry(DEFINITIONS);

export interface CatalogueEntry {
  type: string;
  name: string;
  description: string;
  category: NodeCategory;
  icon: string;
  version: "v1" | "v2";
  requiresFeature: string | null;
  /** Whether the org's plan features cover this node. */
  allowed: boolean;
  inputsSchema: JsonSchema;
  outputsSchema: JsonSchema;
  handles: string[];
}

function defaultInputs(definition: AnyNodeDef): unknown {
  const parsed = definition.inputs.safeParse({});
  return parsed.success ? parsed.data : {};
}

/**
 * The node list the sidebar and the Builder agent see. `features` are the org's Clerk feature
 * slugs (see `lib/plans.ts`); nodes the plan does not cover are still listed, but `allowed`
 * is false so the UI can dim them. Gating is enforced again in `runNode` (Phase 2).
 */
export function nodeCatalogue(features: readonly string[]): CatalogueEntry[] {
  return Object.values(NODES)
    .map((definition) => ({
      type: definition.type,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      icon: definition.icon,
      version: definition.version,
      requiresFeature: definition.requiresFeature,
      allowed: !definition.requiresFeature || features.includes(definition.requiresFeature),
      inputsSchema: toJsonSchema(definition.inputs),
      outputsSchema: toJsonSchema(definition.outputs),
      handles: definition.handles?.(defaultInputs(definition)) ?? ["out"],
    }))
    .sort(
      (a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.name.localeCompare(b.name),
    );
}
