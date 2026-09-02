import { describe, expect, it } from "vitest";

import {
  credentialName,
  templateById,
  templateFeature,
  templateSetup,
  WORKFLOW_TEMPLATES,
  type TemplateGraph,
} from "@/lib/templates";
import { validateWorkflow } from "@/lib/validate-workflow";
import { NODES } from "@/nodes/registry";

/**
 * A template is a graph the app will hand straight to `workflows.create`, so the only interesting
 * question is whether it would run. `validateWorkflow` is the same check the Builder agent and the
 * engine make, which makes it the right judge here.
 *
 * The one thing a template is allowed to leave undone is a field only the reader can fill in — the
 * connection behind an AI node, the chat an Approval asks in. Those nodes are named by
 * `templateSetup()`, shown on the card before the template is picked, and are the only nodes a
 * problem may belong to.
 */
describe("workflow templates", () => {
  it("ships five starter workflows with unique ids", () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(5);
    expect(new Set(WORKFLOW_TEMPLATES.map((entry) => entry.id)).size).toBe(5);
  });

  it.each(WORKFLOW_TEMPLATES.map((entry) => [entry.id, entry] as const))(
    "%s is built only from registered node types",
    (_id, entry) => {
      for (const graphNode of entry.graph.nodes) {
        expect(NODES[graphNode.data.nodeType], graphNode.data.nodeType).toBeDefined();
      }
    },
  );

  it.each(WORKFLOW_TEMPLATES.map((entry) => [entry.id, entry] as const))(
    "%s validates, leaving work only on the nodes it says need connecting",
    (_id, entry) => {
      const { problems } = validateWorkflow(entry.graph);
      const allowed = new Set(templateSetup(entry.graph).map((step) => step.nodeId));

      // A problem with no `nodeId` is structural — no trigger, two triggers, a dangling edge — and
      // a template is never allowed one.
      expect(problems.filter((problem) => problem.nodeId === undefined)).toEqual([]);
      expect(
        problems.filter((problem) => !allowed.has(problem.nodeId ?? "")).map((p) => p.message),
      ).toEqual([]);
    },
  );

  it("has nothing left to configure in the templates that need no connection", () => {
    for (const entry of WORKFLOW_TEMPLATES) {
      if (templateSetup(entry.graph).length > 0) continue;
      expect(validateWorkflow(entry.graph), entry.id).toEqual({ ok: true, problems: [] });
    }
    // …and at least one template is in that state, or the assertion above is vacuous.
    expect(
      WORKFLOW_TEMPLATES.filter((entry) => templateSetup(entry.graph).length === 0).length,
    ).toBeGreaterThan(0);
  });

  it("gives every node a unique, template-safe key that matches its id", () => {
    for (const entry of WORKFLOW_TEMPLATES) {
      const keys = entry.graph.nodes.map((graphNode) => graphNode.data.key);
      expect(new Set(keys).size, entry.id).toBe(keys.length);
      for (const graphNode of entry.graph.nodes) {
        expect(graphNode.data.key, entry.id).toMatch(/^[a-z][a-z0-9_]*$/);
        // The picker and the canvas both address a template node by key; keeping id and key equal
        // means a `{{ key.… }}` in one node points at the node the edges point at.
        expect(graphNode.id, entry.id).toBe(graphNode.data.key);
      }
    }
  });

  it("points every edge at a node in the same graph", () => {
    for (const entry of WORKFLOW_TEMPLATES) {
      const ids = new Set(entry.graph.nodes.map((graphNode) => graphNode.id));
      for (const graphEdge of entry.graph.edges) {
        expect(ids.has(graphEdge.source), `${entry.id}: ${graphEdge.id}`).toBe(true);
        expect(ids.has(graphEdge.target), `${entry.id}: ${graphEdge.id}`).toBe(true);
      }
      expect(new Set(entry.graph.edges.map((graphEdge) => graphEdge.id)).size).toBe(
        entry.graph.edges.length,
      );
    }
  });

  it("names the trigger each graph starts from", () => {
    for (const entry of WORKFLOW_TEMPLATES) {
      const trigger = entry.graph.nodes.find(
        (graphNode) => graphNode.id === entry.graph.triggerId,
      );
      expect(trigger, entry.id).toBeDefined();
      expect(NODES[trigger!.data.nodeType].category).toBe("trigger");
    }
  });
});

describe("templateSetup", () => {
  it("names the AI and Telegram connections the lead template needs", () => {
    const lead = templateById("lead-intake");
    expect(lead).toBeDefined();
    expect(templateSetup(lead!.graph)).toEqual([
      { nodeId: "classify", label: "Urgent or not", credential: "ai" },
      { nodeId: "ping_team", label: "Ping the team", credential: "telegram" },
    ]);
  });

  it("skips a node whose connection is optional", () => {
    // The hourly template ends in Send email, which runs on the platform key until an organisation
    // connects its own Resend account — so it is not something to do before the first run.
    const hourly = templateById("hourly-check");
    expect(templateSetup(hourly!.graph)).toEqual([]);
  });
});

describe("templateFeature", () => {
  it("finds no plan-gated node in the starter templates", () => {
    for (const entry of WORKFLOW_TEMPLATES) {
      expect(entry.requiresFeature, entry.id).toBeUndefined();
    }
  });

  it("reports the feature slug of a graph that uses a Pro connector", () => {
    const pro: TemplateGraph = {
      nodes: [
        {
          id: "post",
          type: "papaflow",
          position: { x: 0, y: 0 },
          data: { nodeType: "slack.postMessage", key: "post", label: "Post", inputs: {} },
        },
      ],
      edges: [],
    };
    expect(templateFeature(pro)).toBe("pro_connectors");
  });
});

describe("credentialName", () => {
  it("reads a credential slug as a sentence", () => {
    expect(credentialName("ai")).toBe("an AI provider");
    expect(credentialName("chat")).toBe("Slack, Discord or Telegram");
    expect(credentialName("telegram")).toBe("Telegram");
  });

  it("falls back to the slug for a credential it has no wording for", () => {
    expect(credentialName("brand-new")).toBe("brand-new");
  });
});
