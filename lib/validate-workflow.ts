// Is this graph runnable? Pure, registry-aware, and free of React, Next and Convex: the Builder
// agent calls it through its `validate_workflow` tool, and it is the same question `runGraph`
// would answer at run time, only sooner and with sentences a model can act on.
//
// Nothing here does I/O. The graph is user data (`workflows.graph` is `v.any()`), so every field
// is read defensively rather than trusted, exactly as `workflows/graph.ts#toRunGraph` reads it.
import type { z } from "zod";

import type { AnyNodeDef } from "@/nodes/define";
import { NODES } from "@/nodes/registry";

/** The single source handle of a node that does not branch; edges leave it with no `sourceHandle`. */
const DEFAULT_HANDLE = "out";

/** One thing wrong with the graph. `nodeId` is set when the problem belongs to a single node. */
export type WorkflowProblem = { nodeId?: string; message: string };

export type ValidationResult = { ok: boolean; problems: WorkflowProblem[] };

/** A node as the graph stores it, seen through the fields validation reads. */
type StoredNode = {
  id: string;
  data: { nodeType: string; key: string; label: string; inputs: Record<string, unknown> };
};

type StoredEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
};

export type ValidateOptions = {
  /** The org's Clerk feature slugs. When given, a node the plan cannot run is a problem. */
  features?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** True for a value that is (or contains) a `{{ template }}`, which stands in for any type. */
function isTemplate(value: unknown): boolean {
  return typeof value === "string" && value.includes("{{") && value.includes("}}");
}

/**
 * The value at a zod issue's path, and whether the path exists at all.
 *
 * A missing key and a key holding `undefined` are the same thing to zod, and they are the same
 * thing here too: both mean "not configured yet", which is a problem when the workflow is about to
 * run and not a problem while the Builder is still placing nodes.
 */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = input;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

export type InputIssue = { path: string; message: string };

export type InputIssueOptions = {
  /**
   * Treat a required field that has not been set yet as fine. The Builder edits one node at a
   * time — `add_node` then `configure_node` — so a half-configured node must not be an error
   * until `validate_workflow` asks whether the workflow could actually run.
   */
  allowMissing?: boolean;
};

/**
 * A node's configuration checked against its own zod schema, with two rules the raw parse cannot
 * express:
 *
 * 1. **A `{{ template }}` may stand where the schema wants any type.** The engine resolves
 *    templates before `inputs.parse()` (`nodes/templates.ts`), so `{{ trigger.count }}` in a
 *    `z.number()` field is correct configuration, not a type error.
 * 2. **Missing is optionally allowed**, so the same function serves a half-built node and a
 *    finished one.
 */
export function inputIssues(
  definition: AnyNodeDef,
  inputs: Record<string, unknown>,
  options: InputIssueOptions = {},
): InputIssue[] {
  const parsed = definition.inputs.safeParse(inputs);
  if (parsed.success) return [];

  const issues: InputIssue[] = [];
  for (const issue of (parsed.error as z.ZodError).issues) {
    const value = valueAt(inputs, issue.path);
    if (isTemplate(value)) continue;
    if (options.allowMissing && value === undefined) continue;

    const path = issue.path.map(String).join(".");
    issues.push({
      path,
      message: value === undefined && path ? `${path} is required` : `${path || "inputs"}: ${issue.message}`,
    });
  }
  return issues;
}

/**
 * The source handles a node offers. `handles()` is node code reading a possibly half-finished
 * config — a Switch with no `cases` yet — so the stored inputs go through the node's own schema
 * first (which supplies the defaults) and a definition that throws falls back to the single
 * default handle. Same rule as the canvas' `graph-io.ts#sourceHandles`, kept here so this module
 * stays importable from an eve agent without reaching into `components/`.
 */
export function sourceHandlesFor(
  definition: AnyNodeDef,
  inputs: Record<string, unknown>,
): string[] {
  if (!definition.handles) return [DEFAULT_HANDLE];
  const parsed = definition.inputs.safeParse(inputs);
  try {
    const handles = definition.handles(parsed.success ? parsed.data : inputs);
    return handles.length > 0 ? handles : [DEFAULT_HANDLE];
  } catch {
    return [DEFAULT_HANDLE];
  }
}

/** Stored nodes, defensively: anything without an id or a `nodeType` is not a node. */
function readNodes(raw: unknown): StoredNode[] {
  const nodes: StoredNode[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    const data = isRecord(entry.data) ? entry.data : {};
    const nodeType = str(data.nodeType);
    if (!id || !nodeType) continue;
    nodes.push({
      id,
      data: {
        nodeType,
        key: str(data.key) ?? "",
        label: str(data.label) ?? nodeType,
        inputs: isRecord(data.inputs) ? data.inputs : {},
      },
    });
  }
  return nodes;
}

function readEdges(raw: unknown): StoredEdge[] {
  const edges: StoredEdge[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    const source = str(entry.source);
    const target = str(entry.target);
    if (!id || !source || !target) continue;
    edges.push({ id, source, target, sourceHandle: str(entry.sourceHandle) ?? null });
  }
  return edges;
}

/** How a node is named in a problem message: its template key if it has one, else its id. */
function nameOf(node: StoredNode): string {
  return node.data.key || node.id;
}

/**
 * Everything that would stop this graph running, in one pass.
 *
 * The checks, in the order a person hits them:
 *
 * - exactly one trigger node (none means nothing can start it; two means the engine picks one);
 * - every node type is registered (a graph can outlive the node it was drawn with);
 * - every node's inputs satisfy its schema, with `{{ templates }}` standing in for any type;
 * - every edge joins two nodes that exist, leaving a handle the source actually declares;
 * - no non-trigger node is orphaned (nothing wired into it, so the walk never reaches it);
 * - every node that needs a connection has one, unless its connection is optional.
 *
 * `ok` is `problems.length === 0`. Order is stable — graph order, then check order per node — so
 * the Builder sees the same list twice if it changes nothing.
 */
export function validateWorkflow(
  graph: { nodes?: unknown; edges?: unknown } | null | undefined,
  options: ValidateOptions = {},
): ValidationResult {
  const nodes = readNodes(graph?.nodes);
  const edges = readEdges(graph?.edges);
  const problems: WorkflowProblem[] = [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const definitions = new Map<string, AnyNodeDef>();

  // --- nodes -------------------------------------------------------------------------------
  const triggers: StoredNode[] = [];
  for (const node of nodes) {
    const definition = NODES[node.data.nodeType];
    if (!definition) {
      problems.push({
        nodeId: node.id,
        message: `${nameOf(node)} has an unknown node type "${node.data.nodeType}".`,
      });
      continue;
    }
    definitions.set(node.id, definition);
    if (definition.category === "trigger") triggers.push(node);

    if (options.features && definition.requiresFeature) {
      if (!options.features.includes(definition.requiresFeature)) {
        problems.push({
          nodeId: node.id,
          message: `${nameOf(node)} (${definition.name}) needs the "${definition.requiresFeature}" feature, which this organisation's plan does not include.`,
        });
      }
    }

    for (const issue of inputIssues(definition, node.data.inputs)) {
      problems.push({ nodeId: node.id, message: `${nameOf(node)}: ${issue.message}` });
    }

    if (definition.credential && !definition.credentialOptional) {
      const connectionId = node.data.inputs.connectionId;
      if (typeof connectionId !== "string" || connectionId.length === 0) {
        problems.push({
          nodeId: node.id,
          message: `${nameOf(node)} (${definition.name}) needs a ${definition.credential} connection — call request_connection, then configure_node with the connectionId.`,
        });
      }
    }
  }

  if (nodes.length === 0) {
    problems.push({ message: "The workflow is empty. Add a trigger node first." });
  } else if (triggers.length === 0) {
    problems.push({ message: "The workflow has no trigger node, so nothing can start it." });
  } else if (triggers.length > 1) {
    problems.push({
      message: `The workflow has ${triggers.length} trigger nodes (${triggers
        .map(nameOf)
        .join(", ")}); a workflow may only have one.`,
    });
  }

  // --- edges -------------------------------------------------------------------------------
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      problems.push({
        message: `An edge points at a node that is not in the workflow (${edge.source} → ${edge.target}).`,
      });
      continue;
    }

    const definition = definitions.get(source.id);
    if (!definition) continue; // already reported as an unknown node type

    const handles = sourceHandlesFor(definition, source.data.inputs);
    const handle = edge.sourceHandle ?? DEFAULT_HANDLE;
    if (!handles.includes(handle)) {
      problems.push({
        nodeId: source.id,
        message: `${nameOf(source)} has no "${handle}" output (it offers ${handles
          .map((entry) => `"${entry}"`)
          .join(", ")}).`,
      });
    }
  }

  // --- reachability ------------------------------------------------------------------------
  const wiredInto = new Set(edges.filter((edge) => byId.has(edge.source)).map((edge) => edge.target));
  for (const node of nodes) {
    const definition = definitions.get(node.id);
    if (!definition || definition.category === "trigger") continue;
    if (wiredInto.has(node.id)) continue;
    problems.push({
      nodeId: node.id,
      message: `${nameOf(node)} has nothing wired into it, so a run would never reach it.`,
    });
  }

  return { ok: problems.length === 0, problems };
}
