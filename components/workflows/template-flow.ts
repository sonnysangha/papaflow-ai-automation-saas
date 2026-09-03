/**
 * Reading a starter template as a sentence: trigger → action → action.
 *
 * A card cannot show a graph, and a bag of node chips in storage order does not say what the
 * template *does* — so the strip walks the graph the way you would read it, from the trigger along
 * the first edge out of each node. Branches are real (a Condition has two), but only one of them
 * can be the headline, and the first edge is the one the template author drew first.
 *
 * Pure and React-free so the picker and its test read the same walk.
 */

import type { TemplateGraph, WorkflowTemplate } from "@/lib/templates";

/** One hop of the main path: the node's type (for its icon) and the label the template gave it. */
export type FlowStep = { nodeType: string; label: string };

/** The two node types that head a graph without saying `.trigger` in their name. */
const EVENT_TRIGGER_TYPES = new Set(["telegram.message", "stripe.event"]);

function isTriggerType(nodeType: string): boolean {
  return nodeType.endsWith(".trigger") || EVENT_TRIGGER_TYPES.has(nodeType);
}

/**
 * The main path through `graph`, starting at its trigger and following the first outgoing edge at
 * every hop. Returns `[]` for a graph with no trigger to start from — there is no honest place to
 * begin reading one.
 *
 * A graph that loops back on itself stops at the node it has already shown, so the walk always
 * terminates.
 */
export function templateFlow(graph: TemplateGraph): FlowStep[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  const start =
    (graph.triggerId === undefined ? undefined : byId.get(graph.triggerId)) ??
    graph.nodes.find((node) => isTriggerType(node.data.nodeType));
  if (!start) return [];

  const steps: FlowStep[] = [];
  const seen = new Set<string>();

  let current = start;
  while (!seen.has(current.id)) {
    seen.add(current.id);
    steps.push({ nodeType: current.data.nodeType, label: current.data.label });

    const edge = graph.edges.find((candidate) => candidate.source === current.id);
    const next = edge ? byId.get(edge.target) : undefined;
    if (!next) break;
    current = next;
  }

  return steps;
}

/**
 * The main path clipped to what fits on a card, with everything the card is not showing counted —
 * both the hops past the limit and the nodes hanging off branches, because "+3 more" is about how
 * much of the template is out of sight rather than about the walk.
 */
export function flowStrip(
  graph: TemplateGraph,
  limit = 6,
): { steps: FlowStep[]; more: number } {
  const path = templateFlow(graph);
  const steps = path.slice(0, limit);
  return { steps, more: Math.max(0, graph.nodes.length - steps.length) };
}

/** The value the category filter uses for "show everything". Not a category any template has. */
export const ALL_CATEGORIES = "all";

export type TemplateCategory = { value: string; label: string; count: number };

/**
 * The category chips: `All`, then every category in the order the templates first mention it, each
 * with how many templates it holds. First-seen order rather than alphabetical, so the shelf reads
 * in the order the list was curated in.
 */
export function templateCategories(
  templates: readonly WorkflowTemplate[],
): TemplateCategory[] {
  const counts = new Map<string, number>();
  for (const template of templates) {
    counts.set(template.category, (counts.get(template.category) ?? 0) + 1);
  }

  return [
    { value: ALL_CATEGORIES, label: "All", count: templates.length },
    ...[...counts].map(([value, count]) => ({ value, label: value, count })),
  ];
}

/**
 * The templates a search box and a category chip leave standing. The query is matched against the
 * words a reader would type — name, description and category — case-insensitively.
 */
export function filterTemplates(
  templates: readonly WorkflowTemplate[],
  { query, category }: { query: string; category: string },
): WorkflowTemplate[] {
  const needle = query.trim().toLowerCase();

  return templates.filter((template) => {
    if (category !== ALL_CATEGORIES && template.category !== category) return false;
    if (!needle) return true;

    return `${template.name} ${template.description} ${template.category}`
      .toLowerCase()
      .includes(needle);
  });
}
