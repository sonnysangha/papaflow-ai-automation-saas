// The list the `{}` picker offers for one node: every root a template may start with, and every
// path under it. Two sources feed it and they answer different questions — the node's `outputs`
// schema says what a node *always* returns, and the last run says what was actually there, which
// is the only thing that can describe an HTTP body or a webhook payload.
//
// Pure, so the merge rules are unit-testable; `VariablePicker` only renders what comes back.
import type { Edge } from "@xyflow/react";

import { outputPaths, type OutputPath } from "@/nodes/paths";
import { NODES } from "@/nodes/registry";
import { loopFor } from "@/workflows/graph";

import type { WorkflowNodeType } from "./graph-io";
import { previewOf, type LastRunSource } from "./last-run";

/** One insertable template path, already prefixed with its root (`http_request_1.body`). */
export type VariableEntry = {
  path: string;
  type: string;
  /** True when the path came from the last run's output rather than the node's output schema. */
  observed: boolean;
  /** What the last run had at this path, when it ran; empty when there is nothing to show. */
  preview: string;
};

export type VariableGroup = {
  /** Root of every entry in the group — a node key, `trigger`, or `$item`. */
  key: string;
  label: string;
  /** True when the latest run recorded an output for this group's node. */
  ran: boolean;
  entries: VariableEntry[];
};

/** The reserved root for the element a Loop body is currently working on. */
const ITEM_ROOT = "$item";

/**
 * Schema paths first — the fields a node promises — then anything the last run showed that the
 * schema did not describe, which is where `body.items[0].id` comes from. A schema path the run
 * also produced keeps its schema type and picks up the run's value as its preview.
 */
function mergePaths(schema: OutputPath[], observed: PathPreviewMap): VariableEntry[] {
  const entries: VariableEntry[] = schema.map((path) => ({
    ...path,
    observed: false,
    preview: observed.get(path.path)?.preview ?? "",
  }));

  const seen = new Set(entries.map((entry) => entry.path));
  for (const [path, found] of observed) {
    if (seen.has(path)) continue;
    seen.add(path);
    entries.push({ path, type: found.type, observed: true, preview: found.preview });
  }
  return entries;
}

type PathPreviewMap = Map<string, { type: string; preview: string }>;

function previewMap(source: LastRunSource): PathPreviewMap {
  return new Map(source.paths.map((path) => [path.path, { type: path.type, preview: path.preview }]));
}

/** A definition's `outputs` may be any zod schema; a conversion failure must not blank the list. */
function schemaPaths(nodeType: string): OutputPath[] {
  const definition = NODES[nodeType];
  if (!definition) return [];
  try {
    return outputPaths(definition.outputs);
  } catch {
    return [];
  }
}

function prefixed(root: string, entries: VariableEntry[]): VariableEntry[] {
  return entries.map((entry) => ({ ...entry, path: `${root}.${entry.path}` }));
}

/** "Trigger payload" for the reserved root, "Greet · set_1" for a node — its two names. */
function headingFor(source: LastRunSource): string {
  return source.reserved ? "Trigger payload" : `${source.label} · ${source.key}`;
}

/** One group per root: the whole output as `{{ key }}`, then every path under it. */
function groupFor(source: LastRunSource): VariableGroup {
  const paths = mergePaths(schemaPaths(source.nodeType), previewMap(source));
  return {
    key: source.key,
    label: headingFor(source),
    ran: source.ran,
    entries: [
      {
        path: source.key,
        type: "object",
        observed: false,
        preview: source.ran ? previewOf(source.output) : "",
      },
      ...prefixed(source.key, paths),
    ],
  };
}

/**
 * What the picker offers for one node: a group per root the last run described (its ancestors,
 * nearest first, then `trigger`), plus `$item` where a Loop body makes it resolvable.
 *
 * `sources` comes from `lastRunFor`, so the groups follow the run's own data; the schema half is
 * added here, which is what makes the picker useful before the workflow has ever run.
 */
export function buildVariableGroups({
  nodeId,
  nodes,
  edges,
  sources,
}: {
  nodeId: string;
  nodes: readonly WorkflowNodeType[];
  edges: readonly Edge[];
  sources: readonly LastRunSource[];
}): VariableGroup[] {
  const groups = sources.filter((source) => !source.reserved).map(groupFor);

  // `$item` is the other reserved root, and unlike `trigger` it only exists somewhere: on the body
  // of a Loop, where every node runs once per element. `loopFor` is the same pure helper the
  // orchestrator uses to decide what a body is, so the picker offers `{{ $item }}` exactly where
  // the run will resolve it.
  // No sub-paths: the item is whatever the loop's list holds, and no step row records it — the
  // author knows its shape, and `{{ $item.name }}` can be typed on from here.
  if (loopFor({ nodes: Object.fromEntries(nodes.map((node) => [node.id, node])), edges }, nodeId)) {
    groups.push({
      key: ITEM_ROOT,
      label: "Loop item",
      ran: false,
      entries: [{ path: ITEM_ROOT, type: "any", observed: false, preview: "" }],
    });
  }

  // `trigger` resolves to the trigger's payload in every node's context, whether or not the
  // trigger is an ancestor of this node, so the group is listed even on a disconnected node.
  for (const source of sources) {
    if (source.reserved) groups.push(groupFor(source));
  }

  return groups;
}

/**
 * How one row reads to a screen reader. The path alone is half the row — the value beside it is
 * what tells you this is the field you meant — so both are spoken, along with the marker that says
 * the path exists because a run produced it rather than because the node promised it.
 */
export function variableEntryLabel(entry: VariableEntry): string {
  const parts = [`Insert {{ ${entry.path} }}`, entry.type];
  if (entry.preview) parts.push(`value ${entry.preview}`);
  if (entry.observed) parts.push("from last run");
  return parts.join(", ");
}
