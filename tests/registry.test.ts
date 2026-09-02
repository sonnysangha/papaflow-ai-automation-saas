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
    expect(catalogue).toHaveLength(3);
    expect(catalogue.map((entry) => entry.type).sort()).toEqual([
      "email.send",
      "http.request",
      "manual.trigger",
    ]);

    for (const entry of catalogue) {
      expect(entry.allowed).toBe(true);
      expect(entry.version).toBe("v1");
      expect(entry.inputsSchema.type).toBe("object");
      expect(entry.outputsSchema.type).toBe("object");
      expect(entry.handles).toEqual(["out"]);
      expect(entry.icon).toBeTruthy();
      expect(entry.description).toBeTruthy();
    }
  });

  it("still allows nodes whose requiresFeature is null when the org has no features", () => {
    const catalogue = nodeCatalogue([]);
    expect(catalogue).toHaveLength(3);
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
