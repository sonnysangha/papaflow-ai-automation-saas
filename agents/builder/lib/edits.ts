import {
  activateBuilderWorkflow,
  addBuilderNode,
  builderErrorMessage,
  configureBuilderNode,
  connectBuilderNodes,
  getBuilderWorkflow,
  removeBuilderNode,
  type BuilderWorkflow,
  type EditIdentity,
} from "../../../lib/builder-engine";
import { isEngineUnavailable } from "../../../lib/engine-env";
import { inputIssues, sourceHandlesFor, validateWorkflow } from "../../../lib/validate-workflow";
import { NODES, nodeCatalogue } from "../../../nodes/registry";

import type { BuilderSession } from "./session";
import { viaEngine } from "./tool-result";

/**
 * What the Builder's tools actually do, minus the tool boilerplate.
 *
 * It lives in `lib/` because every file under `agents/<name>/tools/` is registered as a tool named
 * after its slug — the same reason `agents/runtime/lib/connector-tools.ts` exists — and because the
 * interesting decisions here are decisions about a graph, testable without a session or a model.
 *
 * Two rules shape every function:
 *
 * 1. **The registry is the authority on a node.** A type the registry does not know, an input the
 *    node's zod schema refuses, a handle the node does not declare: all refused here, in the eve
 *    service, where the registry can be imported. Convex validates structure and ownership
 *    (`convex/builder.ts` explains why it cannot import `nodes/registry.ts`).
 * 2. **A refusal is a sentence, not a stack trace.** Everything throws `Error(message)` with
 *    something the model can act on, because the model is the one reading it.
 */

/** How many candidate node types a "did you mean" list is allowed to name. */
const SUGGESTIONS = 6;

function identityOf(session: BuilderSession): EditIdentity {
  return { workflowId: session.workflowId, orgId: session.orgId, userId: session.userId };
}

/**
 * Every Convex refusal becomes a sentence the model can act on; an unreachable backend keeps its
 * `EngineUnavailableError` class all the way up to the tool, which returns it as a terminal result
 * instead of throwing something the model will retry (`./tool-result.ts`).
 */
async function convex<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await viaEngine(operation);
  } catch (error) {
    if (isEngineUnavailable(error)) throw error;
    throw new Error(builderErrorMessage(error));
  }
}

/** The node definition for a type, or a refusal naming the closest things it could have meant. */
function definitionFor(type: string) {
  const definition = NODES[type];
  if (definition) return definition;

  const [namespace] = type.split(".");
  const near = Object.keys(NODES)
    .filter((known) => known.startsWith(`${namespace}.`) || known.includes(type))
    .slice(0, SUGGESTIONS);
  throw new Error(
    `There is no node type "${type}".` +
      (near.length > 0
        ? ` Did you mean ${near.join(", ")}?`
        : " Call list_node_types to see what exists."),
  );
}

/** Refuses a node the organisation's plan cannot run, before it is ever placed on the canvas. */
function assertAllowed(session: BuilderSession, type: string): void {
  const definition = NODES[type];
  const feature = definition?.requiresFeature;
  if (feature && !session.features.includes(feature)) {
    throw new Error(
      `${definition?.name ?? type} needs the "${feature}" feature, which this organisation's plan does not include. Choose another node.`,
    );
  }
}

/* -------------------------------------------------------------------------------------------------
 * The catalogue.
 * ---------------------------------------------------------------------------------------------- */

export type CatalogueSummary = {
  type: string;
  name: string;
  description: string;
  category: string;
  credential: string | null;
  requiresFeature: string | null;
  allowed: boolean;
};

export type CatalogueDetail = CatalogueSummary & {
  inputs: unknown;
  outputs: unknown;
  handles: string[];
  /**
   * The node's own explanation of itself, and what each of its handles means — read-only, and only
   * at this depth. `handles` alone says a Loop has `each` and `done`; this says which one the body
   * hangs off, which is the half a plan gets wrong.
   */
  guide?: { summary: string; outputs?: Record<string, string> };
};

/**
 * The node catalogue, in two depths.
 *
 * Without `types` it is a one-line-per-node summary — twenty-eight nodes' JSON Schemas at once
 * would be most of a context window spent before the model has decided anything. With `types` it
 * is the full input and output schemas for the handful the model actually picked, which is what
 * `configure_node` needs to get right.
 */
export function catalogue(
  features: readonly string[],
  options: { category?: string; types?: readonly string[] } = {},
): { nodes: CatalogueSummary[] | CatalogueDetail[] } {
  const entries = nodeCatalogue(features);

  if (options.types && options.types.length > 0) {
    const wanted = new Set(options.types);
    const detail: CatalogueDetail[] = entries
      .filter((entry) => wanted.has(entry.type))
      .map((entry) => ({
        type: entry.type,
        name: entry.name,
        description: entry.description,
        category: entry.category,
        credential: NODES[entry.type]?.credential ?? null,
        requiresFeature: entry.requiresFeature,
        allowed: entry.allowed,
        inputs: entry.inputsSchema,
        outputs: entry.outputsSchema,
        handles: entry.handles,
        guide: NODES[entry.type]?.guide,
      }));

    const missing = options.types.filter((type) => !NODES[type]);
    if (missing.length > 0 && detail.length === 0) {
      throw new Error(
        `No such node type: ${missing.join(", ")}. Call list_node_types with no arguments to see what exists.`,
      );
    }
    return { nodes: detail };
  }

  const summaries: CatalogueSummary[] = entries
    .filter((entry) => !options.category || entry.category === options.category)
    .map((entry) => ({
      type: entry.type,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      credential: NODES[entry.type]?.credential ?? null,
      requiresFeature: entry.requiresFeature,
      allowed: entry.allowed,
    }));

  return { nodes: summaries };
}

/* -------------------------------------------------------------------------------------------------
 * Edits.
 * ---------------------------------------------------------------------------------------------- */

/** The workflow as the tools read it back, refusing if it is not this organisation's. */
export async function readWorkflow(session: BuilderSession): Promise<BuilderWorkflow> {
  const workflow = await convex(() => getBuilderWorkflow(session.workflowId, session.orgId));
  if (!workflow) {
    throw new Error("That workflow does not exist, or it belongs to another organisation.");
  }
  return workflow;
}

export type AddNodeArgs = { type: string; label?: string; inputs?: Record<string, unknown> };

/**
 * Places one node. Inputs are optional and validated leniently — the Builder adds a node and then
 * configures it, so "not set yet" is not an error until `validate_workflow` asks.
 */
export async function addNode(session: BuilderSession, args: AddNodeArgs) {
  const definition = definitionFor(args.type);
  assertAllowed(session, args.type);

  const inputs = args.inputs ?? {};
  const issues = inputIssues(definition, inputs, { allowMissing: true });
  if (issues.length > 0) {
    throw new Error(
      `${definition.name} cannot be configured that way: ${issues.map((issue) => issue.message).join("; ")}.`,
    );
  }

  const created = await convex(() =>
    addBuilderNode(identityOf(session), {
      nodeType: args.type,
      label: args.label ?? definition.name,
      inputs,
      isTrigger: definition.category === "trigger",
    }),
  );

  return {
    added: definition.name,
    node: created.key,
    nodeId: created.nodeId,
    version: created.version,
    needs: inputIssues(definition, inputs, {}).map((issue) => issue.path).filter(Boolean),
  };
}

export type ConnectArgs = { from: string; to: string; sourceHandle?: string };

/** Wires two nodes together, refusing a handle the source node does not declare. */
export async function connectNodes(session: BuilderSession, args: ConnectArgs) {
  const workflow = await readWorkflow(session);
  const source = findStoredNode(workflow, args.from);
  if (source) {
    const definition = NODES[source.nodeType];
    if (definition) {
      const handles = sourceHandlesFor(definition, source.inputs);
      const handle = args.sourceHandle ?? "out";
      if (!handles.includes(handle)) {
        throw new Error(
          `${definition.name} has no "${handle}" output. It offers ${handles.map((entry) => `"${entry}"`).join(", ")}.`,
        );
      }
    }
  }

  const edge = await convex(() => connectBuilderNodes(identityOf(session), args));
  return {
    connected: `${args.from} → ${args.to}${args.sourceHandle ? ` (${args.sourceHandle})` : ""}`,
    edgeId: edge.edgeId,
    version: edge.version,
  };
}

export type ConfigureArgs = { node: string; inputs: Record<string, unknown>; label?: string };

/**
 * Merges configuration into one node, then reports what is still missing — the model's cue to keep
 * going rather than to call `validate_workflow` and be told the same thing twice.
 */
export async function configureNode(session: BuilderSession, args: ConfigureArgs) {
  const workflow = await readWorkflow(session);
  const stored = findStoredNode(workflow, args.node);
  if (!stored) {
    throw new Error(`There is no node "${args.node}" in this workflow.`);
  }

  const definition = definitionFor(stored.nodeType);
  const merged = { ...stored.inputs, ...args.inputs };
  const issues = inputIssues(definition, merged, { allowMissing: true });
  if (issues.length > 0) {
    throw new Error(
      `${definition.name} cannot be configured that way: ${issues.map((issue) => issue.message).join("; ")}.`,
    );
  }

  const result = await convex(() => configureBuilderNode(identityOf(session), args));
  return {
    configured: stored.key,
    version: result.version,
    needs: inputIssues(definition, merged, {}).map((issue) => issue.path).filter(Boolean),
  };
}

/** Deletes a node and every edge touching it. The tool asks the human first. */
export async function removeNode(session: BuilderSession, node: string) {
  const result = await convex(() => removeBuilderNode(identityOf(session), node));
  return {
    removed: result.key || result.nodeId,
    removedEdges: result.removedEdges,
    version: result.version,
  };
}

/** Everything that would stop this graph running, as the run would find it. */
export async function validate(session: BuilderSession) {
  const workflow = await readWorkflow(session);
  const result = validateWorkflow(workflow.graph, { features: session.features });
  return {
    ok: result.ok,
    problems: result.problems.map((problem) => problem.message),
    nodes: (workflow.graph.nodes ?? []).length,
  };
}

/**
 * Marks the workflow active and describes how it starts.
 *
 * A webhook trigger's URL is deliberately *not* returned: it carries `workflows.webhookSecret`, and
 * a secret must never reach the model (CLAUDE.md rule 1). The user reads it off the node's panel,
 * where it has always been.
 */
export async function finish(session: BuilderSession, summary: string) {
  const before = await readWorkflow(session);
  const validation = validateWorkflow(before.graph, { features: session.features });
  const activated = await convex(() => activateBuilderWorkflow(identityOf(session)));

  const triggerType = triggerTypeOf(before);
  const origin = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");

  return {
    workflow: activated.name,
    status: activated.status,
    summary,
    trigger: triggerType ? (NODES[triggerType]?.name ?? triggerType) : "none",
    startsWith: startsWith(triggerType, origin, session.workflowId),
    ok: validation.ok,
    problems: validation.problems.map((problem) => problem.message),
  };
}

/* -------------------------------------------------------------------------------------------------
 * Reading the stored graph.
 *
 * `workflows.graph` is `v.any()`, so everything below reads it defensively rather than trusting it,
 * exactly as `workflows/graph.ts#toRunGraph` does.
 * ---------------------------------------------------------------------------------------------- */

type StoredNodeView = { id: string; key: string; nodeType: string; inputs: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedNodes(workflow: BuilderWorkflow): StoredNodeView[] {
  const nodes: StoredNodeView[] = [];
  for (const entry of workflow.graph.nodes ?? []) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const data = isRecord(entry.data) ? entry.data : {};
    if (typeof data.nodeType !== "string") continue;
    nodes.push({
      id: entry.id,
      key: typeof data.key === "string" ? data.key : "",
      nodeType: data.nodeType,
      inputs: isRecord(data.inputs) ? data.inputs : {},
    });
  }
  return nodes;
}

/** A node by id or by template key, the two ways the agent may refer to one. */
function findStoredNode(workflow: BuilderWorkflow, reference: string): StoredNodeView | undefined {
  const nodes = storedNodes(workflow);
  return nodes.find((node) => node.id === reference) ?? nodes.find((node) => node.key === reference);
}

/** The trigger's node type: the stored `triggerId` if it still exists, else the first trigger. */
function triggerTypeOf(workflow: BuilderWorkflow): string | undefined {
  const nodes = storedNodes(workflow);
  const stored = nodes.find((node) => node.id === workflow.graph.triggerId);
  const trigger = stored ?? nodes.find((node) => NODES[node.nodeType]?.category === "trigger");
  return trigger?.nodeType;
}

/** One sentence telling the user how to set this workflow off. */
function startsWith(triggerType: string | undefined, origin: string, workflowId: string): string {
  switch (triggerType) {
    case undefined:
      return "Nothing — this workflow has no trigger yet.";
    case "manual.trigger":
      return "Press Run on the canvas.";
    case "form.trigger":
      return `Open ${origin}/f/${workflowId} and submit the form.`;
    case "webhook.trigger":
      return "POST to the workflow's webhook URL — open the Webhook node on the canvas to copy it.";
    case "schedule.trigger":
      return "It runs on its schedule; enable it from the canvas.";
    default:
      return "It runs when its trigger fires.";
  }
}
