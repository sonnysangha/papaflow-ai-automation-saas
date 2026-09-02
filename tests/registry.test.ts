import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/nodes/categories";
import type { AnyNodeDef } from "@/nodes/define";
import { NODES, buildRegistry, nodeCatalogue } from "@/nodes/registry";

const TYPE_PATTERN = /^[a-z]+\.[a-zA-Z]+$/;

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
    expect(catalogue).toHaveLength(23);
    expect(catalogue.map((entry) => entry.type).sort()).toEqual([
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
      "logic.condition",
      "logic.set",
      "logic.switch",
      "logic.wait",
      "logic.waitForWebhook",
      "manual.trigger",
      "notion.createPage",
      "slack.postMessage",
      "stripe.event",
      "teams.postCard",
      "telegram.message",
      "telegram.sendMessage",
      "webhook.trigger",
    ]);

    for (const entry of catalogue) {
      expect(entry.allowed).toBe(true);
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
    expect(handles["logic.switch"]).toEqual(["default"]);
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
      "logic",
      "logic",
      "logic",
      "logic",
      "logic",
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

  it("still allows nodes whose requiresFeature is null when the org has no features", () => {
    const catalogue = nodeCatalogue([]);
    expect(catalogue).toHaveLength(23);
    for (const entry of catalogue) {
      expect(entry.requiresFeature).toBeNull();
      expect(entry.allowed).toBe(true);
    }
  });

  it("returns a JSON-serialisable catalogue (it crosses the wire to the canvas)", () => {
    const catalogue = nodeCatalogue(["core_connectors"]);
    const roundTripped = JSON.parse(JSON.stringify(catalogue)) as typeof catalogue;
    expect(roundTripped).toEqual(catalogue);
  });
});
