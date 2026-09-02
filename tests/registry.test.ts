import { describe, expect, it } from "vitest";
import { featuresForPlan } from "@/lib/plans";
import { CATEGORIES } from "@/nodes/categories";
import type { AnyNodeDef } from "@/nodes/define";
import { NODES, buildRegistry, nodeCatalogue } from "@/nodes/registry";

const TYPE_PATTERN = /^[a-z]+\.[a-zA-Z]+$/;

/** The four nodes Phase 11 put behind `pro_connectors` — one per Pro connector. Sorted. */
const PRO_NODES = [
  "airtable.createRecord",
  "linear.createIssue",
  "notion.createPage",
  "slack.postMessage",
];

/** Every node gated on a plan feature, and which one. Phase 10 added the Agent node's `ai_agent`. */
const GATED_NODES: Record<string, string> = {
  ...Object.fromEntries(PRO_NODES.map((type) => [type, "pro_connectors"])),
  "ai.agent": "ai_agent",
};

describe("node registry", () => {
  it("keys every definition by its own unique, well-formed type", () => {
    const entries = Object.entries(NODES);
    expect(entries.length).toBeGreaterThanOrEqual(3);

    const types = entries.map(([, def]) => def.type);
    expect(new Set(types).size).toBe(types.length);

    for (const [key, def] of entries) {
      expect(def.type).toBe(key);
      expect(def.type).toMatch(TYPE_PATTERN);
    }
  });

  it("throws at module load when two definitions share a type", () => {
    const twin = NODES["manual.trigger"] as AnyNodeDef;
    expect(() => buildRegistry([twin, twin])).toThrow(/manual\.trigger/);
  });

  it("only uses declared categories", () => {
    const known = new Set(CATEGORIES.map((c) => c.id));
    for (const def of Object.values(NODES)) {
      expect(known.has(def.category)).toBe(true);
    }
  });

  it("builds a catalogue for a plan's features", () => {
    const catalogue = nodeCatalogue(["core_connectors"]);
    expect(catalogue).toHaveLength(27);
    expect(catalogue.map((entry) => entry.type).sort()).toEqual([
      "ai.agent",
      "ai.classify",
      "ai.extract",
      "ai.llm",
      "airtable.createRecord",
      "discord.postMessage",
      "email.send",
      "form.trigger",
      "github.createIssue",
      "http.request",
      "linear.createIssue",
      "logic.approval",
      "logic.condition",
      "logic.loop",
      "logic.set",
      "logic.switch",
      "logic.wait",
      "logic.waitForWebhook",
      "manual.trigger",
      "notion.createPage",
      "schedule.trigger",
      "slack.postMessage",
      "stripe.event",
      "teams.postCard",
      "telegram.message",
      "telegram.sendMessage",
      "webhook.trigger",
    ]);

    for (const entry of catalogue) {
      // `core_connectors` is what `free_org` carries, so the Pro four and the Agent node are
      // listed but not allowed.
      expect(entry.allowed).toBe(!(entry.type in GATED_NODES));
      expect(entry.version).toBe("v1");
      expect(entry.inputsSchema.type).toBe("object");
      expect(entry.outputsSchema.type).toBe("object");
      expect(entry.icon).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  it("lists the branch handles a node advertises for its default configuration", () => {
    const handles = Object.fromEntries(
      nodeCatalogue([]).map((entry) => [entry.type, entry.handles]),
    );

    // A Switch with no cases yet still offers somewhere for the run to go.
    expect(handles["logic.condition"]).toEqual(["true", "false"]);
    // The answer picks the branch: the resumed payload's `handle` is one of exactly these two.
    expect(handles["logic.approval"]).toEqual(["approved", "rejected"]);
    expect(handles["logic.switch"]).toEqual(["default"]);
    // The body hangs off `each`; the run carries on from `done` when the items run out.
    expect(handles["logic.loop"]).toEqual(["each", "done"]);
    expect(handles["logic.set"]).toEqual(["out"]);
    expect(handles["http.request"]).toEqual(["out"]);
  });

  it("groups the catalogue by category in sidebar order", () => {
    expect(nodeCatalogue([]).map((entry) => entry.category)).toEqual([
      "trigger",
      "trigger",
      "trigger",
      "trigger",
      "trigger",
      "trigger",
      "logic",
      "logic",
      "logic",
      "logic",
      "logic",
      "logic",
      "logic",
      "ai",
      "ai",
      "ai",
      "ai",
      "chat",
      "chat",
      "chat",
      "chat",
      "data",
      "data",
      "data",
      "data",
      "action",
      "action",
    ]);
  });

  it("dims exactly the gated nodes for an org with no paid features", () => {
    const catalogue = nodeCatalogue([]);
    expect(catalogue).toHaveLength(27);

    const blocked = catalogue.filter((entry) => !entry.allowed).map((entry) => entry.type);
    expect(blocked.sort()).toEqual(Object.keys(GATED_NODES).sort());

    for (const entry of catalogue) {
      expect(entry.requiresFeature).toBe(GATED_NODES[entry.type] ?? null);
      expect(entry.allowed).toBe(!(entry.type in GATED_NODES));
    }
  });

  it("allows every node on Pro", () => {
    const catalogue = nodeCatalogue(featuresForPlan("pro"));
    expect(catalogue).toHaveLength(27);
    for (const entry of catalogue) expect(entry.allowed).toBe(true);
  });

  it("gates the Agent node on `ai_agent`, the feature Pro and Team carry", () => {
    // The node is useless without the eve Runtime agent, which is a paid surface: `runNode` refuses
    // it for a free org (CLAUDE.md rule 3), so the sidebar must dim it rather than offer it.
    expect(NODES["ai.agent"].requiresFeature).toBe("ai_agent");
    expect(featuresForPlan("free_org")).not.toContain("ai_agent");
    expect(featuresForPlan("pro")).toContain("ai_agent");
  });

  it("keeps each Pro node's feature in step with the connector it needs", () => {
    // A node and its connector must agree, or the sidebar offers something `/api/connections`
    // will never let the org create a credential for.
    for (const type of PRO_NODES) {
      expect(NODES[type].requiresFeature).toBe("pro_connectors");
      expect(NODES[type].credential).toBeTruthy();
    }
  });

  it("returns a JSON-serialisable catalogue (it crosses the wire to the canvas)", () => {
    const catalogue = nodeCatalogue(["core_connectors"]);
    const roundTripped = JSON.parse(JSON.stringify(catalogue)) as typeof catalogue;
    expect(roundTripped).toEqual(catalogue);
  });
});
