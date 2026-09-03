import { describe, expect, it } from "vitest";

import {
  ALL_CATEGORIES,
  filterTemplates,
  flowStrip,
  templateCategories,
  templateFlow,
} from "@/components/workflows/template-flow";
import type { TemplateGraph, TemplateNode, WorkflowTemplate } from "@/lib/templates";
import { WORKFLOW_TEMPLATES } from "@/lib/templates";

/**
 * The card's one-line reading of a template graph.
 *
 * A template is a graph, and a graph has no order — so the strip has to invent one, and the rule it
 * invents has to be defensible: start where the run starts, and at a fork take the branch the
 * author drew first. Everything here is about that rule staying true as the shelf grows.
 */

function node(id: string, nodeType: string, label: string): TemplateNode {
  return {
    id,
    type: "papaflow",
    position: { x: 0, y: 0 },
    data: { nodeType, key: id, label, inputs: {} },
  };
}

/** A chain `start → n1 → n2 → …`, headed by a trigger. */
function chain(length: number): TemplateGraph {
  const nodes = [
    node("start", "manual.trigger", "Run it"),
    ...Array.from({ length }, (_, index) => node(`n${index}`, "http.request", `Step ${index}`)),
  ];
  const edges = nodes.slice(1).map((entry, index) => ({
    id: `e${index}`,
    source: nodes[index].id,
    target: entry.id,
  }));
  return { nodes, edges, triggerId: "start" };
}

describe("templateFlow", () => {
  it("walks a linear chain from the trigger", () => {
    expect(templateFlow(chain(2))).toEqual([
      { nodeType: "manual.trigger", label: "Run it" },
      { nodeType: "http.request", label: "Step 0" },
      { nodeType: "http.request", label: "Step 1" },
    ]);
  });

  it("takes the first outgoing edge at a branch", () => {
    const graph: TemplateGraph = {
      nodes: [
        node("start", "webhook.trigger", "Webhook"),
        node("check", "condition", "Is it urgent?"),
        node("yes", "slack.postMessage", "Tell the team"),
        node("no", "set", "File it"),
      ],
      edges: [
        { id: "e0", source: "start", target: "check" },
        { id: "e1", source: "check", target: "yes", sourceHandle: "true" },
        { id: "e2", source: "check", target: "no", sourceHandle: "false" },
      ],
      triggerId: "start",
    };

    expect(templateFlow(graph).map((step) => step.label)).toEqual([
      "Webhook",
      "Is it urgent?",
      "Tell the team",
    ]);
  });

  it("starts at a trigger-shaped node when the graph names no triggerId", () => {
    const graph: TemplateGraph = {
      nodes: [node("note", "set", "Set"), node("msg", "telegram.message", "Message")],
      edges: [{ id: "e0", source: "msg", target: "note" }],
    };

    expect(templateFlow(graph).map((step) => step.label)).toEqual(["Message", "Set"]);
  });

  it("returns nothing for a graph with no trigger to start from", () => {
    expect(templateFlow({ nodes: [], edges: [] })).toEqual([]);
    expect(
      templateFlow({
        nodes: [node("a", "set", "Set"), node("b", "http.request", "Fetch")],
        edges: [{ id: "e0", source: "a", target: "b" }],
      }),
    ).toEqual([]);
  });

  it("stops rather than looping forever on a cycle", () => {
    const graph: TemplateGraph = {
      nodes: [node("start", "manual.trigger", "Run it"), node("loop", "set", "Again")],
      edges: [
        { id: "e0", source: "start", target: "loop" },
        { id: "e1", source: "loop", target: "start" },
      ],
      triggerId: "start",
    };

    expect(templateFlow(graph).map((step) => step.label)).toEqual(["Run it", "Again"]);
  });
});

describe("flowStrip", () => {
  it("caps the strip and counts everything it is not showing", () => {
    // Nine nodes: the trigger and eight steps.
    const strip = flowStrip(chain(8));

    expect(strip.steps).toHaveLength(6);
    expect(strip.steps.at(-1)?.label).toBe("Step 4");
    expect(strip.more).toBe(3);
  });

  it("counts the nodes hanging off a branch it did not take", () => {
    const graph: TemplateGraph = {
      nodes: [
        node("start", "webhook.trigger", "Webhook"),
        node("check", "condition", "Is it urgent?"),
        node("yes", "slack.postMessage", "Tell the team"),
        node("no", "set", "File it"),
      ],
      edges: [
        { id: "e0", source: "start", target: "check" },
        { id: "e1", source: "check", target: "yes" },
        { id: "e2", source: "check", target: "no" },
      ],
      triggerId: "start",
    };

    expect(flowStrip(graph).more).toBe(1);
  });

  it("shows a short template whole, with nothing left over", () => {
    expect(flowStrip(chain(2))).toEqual({
      steps: [
        { nodeType: "manual.trigger", label: "Run it" },
        { nodeType: "http.request", label: "Step 0" },
        { nodeType: "http.request", label: "Step 1" },
      ],
      more: 0,
    });
  });

  it("draws a strip for every shipped template", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const { steps, more } = flowStrip(template.graph);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.length).toBeLessThanOrEqual(6);
      expect(more).toBeGreaterThanOrEqual(0);
      // The strip always opens on the trigger, which is what makes it readable as a sentence.
      expect(
        steps[0].nodeType.endsWith(".trigger") ||
          ["telegram.message", "stripe.event"].includes(steps[0].nodeType),
      ).toBe(true);
    }
  });
});

const SAMPLE: WorkflowTemplate[] = [
  { id: "a", name: "Support autopilot", description: "Answer tickets", category: "Customer support", graph: chain(1) },
  { id: "b", name: "Draft a post", description: "Write it up", category: "Content", graph: chain(1) },
  { id: "c", name: "Escalate", description: "Tell the team fast", category: "Customer support", graph: chain(1) },
];

describe("templateCategories", () => {
  it("lists All first, then every category in first-seen order with its count", () => {
    expect(templateCategories(SAMPLE)).toEqual([
      { value: ALL_CATEGORIES, label: "All", count: 3 },
      { value: "Customer support", label: "Customer support", count: 2 },
      { value: "Content", label: "Content", count: 1 },
    ]);
  });

  it("counts every shipped template exactly once", () => {
    const [all, ...categories] = templateCategories(WORKFLOW_TEMPLATES);
    expect(all.count).toBe(WORKFLOW_TEMPLATES.length);
    expect(categories.reduce((total, entry) => total + entry.count, 0)).toBe(
      WORKFLOW_TEMPLATES.length,
    );
  });
});

describe("filterTemplates", () => {
  it("matches name, description and category, case-insensitively", () => {
    const filter = (query: string) =>
      filterTemplates(SAMPLE, { query, category: ALL_CATEGORIES }).map((entry) => entry.id);

    expect(filter("SUPPORT")).toEqual(["a", "c"]);
    expect(filter("write it")).toEqual(["b"]);
    expect(filter("")).toEqual(["a", "b", "c"]);
    expect(filter("   ")).toEqual(["a", "b", "c"]);
    expect(filter("nothing here")).toEqual([]);
  });

  it("narrows to one category, and combines with the search", () => {
    expect(
      filterTemplates(SAMPLE, { query: "", category: "Customer support" }).map((e) => e.id),
    ).toEqual(["a", "c"]);
    expect(
      filterTemplates(SAMPLE, { query: "escalate", category: "Content" }).map((e) => e.id),
    ).toEqual([]);
  });
});
