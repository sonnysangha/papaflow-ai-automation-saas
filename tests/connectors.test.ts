import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  buildConnectorRegistry,
  connectorCatalogue,
  hintFor,
} from "@/connectors/registry";

const AI_PROVIDERS = [
  "anthropic",
  "deepseek",
  "elevenlabs",
  "fal",
  "google",
  "groq",
  "mistral",
  "openai",
  "openrouter",
  "xai",
];

const CATALOGUE_KEYS = [
  "allowed",
  "category",
  "docsUrl",
  "fields",
  "icon",
  "kind",
  "name",
  "provider",
  "requiresFeature",
];

function findFunctions(value: unknown, path = "$"): string[] {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) return value.flatMap((entry, index) => findFunctions(entry, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => findFunctions(entry, `${path}.${key}`));
  }
  return [];
}

describe("connector registry", () => {
  it("keys the ten AI connectors by their own unique provider", () => {
    const entries = Object.entries(CONNECTORS);
    expect(entries).toHaveLength(10);

    const providers = entries.map(([, def]) => def.provider);
    expect(new Set(providers).size).toBe(providers.length);
    expect([...providers].sort()).toEqual(AI_PROVIDERS);

    for (const [key, def] of entries) {
      expect(def.provider).toBe(key);
    }
  });

  it("throws at module load when two definitions share a provider", () => {
    const twin = CONNECTORS.openai;
    expect(() => buildConnectorRegistry([twin, twin])).toThrow(/openai/);
  });

  it("describes every AI connector as a single free-to-add api key", () => {
    for (const def of Object.values(CONNECTORS)) {
      expect(def.category).toBe("ai");
      expect(def.kind).toBe("apiKey");
      expect(def.requiresFeature).toBeNull();
      expect(def.name).toBeTruthy();
      expect(def.icon).toBeTruthy();
      expect(def.docsUrl).toMatch(/^https:\/\//);
      expect(def.fields).toHaveLength(1);
      expect(def.fields[0]).toMatchObject({ name: "apiKey", label: "API key", kind: "secret" });
      expect(def.fields[0].placeholder).toBeTruthy();
      expect(typeof def.test).toBe("function");
    }
  });

  it("builds a catalogue that carries no functions across the wire", () => {
    const catalogue = connectorCatalogue([]);

    expect(catalogue).toHaveLength(10);
    expect(findFunctions(catalogue)).toEqual([]);
    expect(JSON.parse(JSON.stringify(catalogue))).toEqual(catalogue);

    for (const entry of catalogue) {
      expect(Object.keys(entry).sort()).toEqual(CATALOGUE_KEYS);
      expect(entry.fields[0].name).toBe("apiKey");
    }
  });

  it("marks every AI connector allowed for an org with no paid features", () => {
    const catalogue = connectorCatalogue([]);
    expect(catalogue).toHaveLength(10);
    for (const entry of catalogue) {
      expect(entry.requiresFeature).toBeNull();
      expect(entry.allowed).toBe(true);
    }
  });

  it("copies the field specs so the catalogue cannot mutate a definition", () => {
    const [entry] = connectorCatalogue([]);
    entry.fields[0].label = "tampered";
    expect(CONNECTORS[entry.provider].fields[0].label).toBe("API key");
  });

  it("groups the catalogue by category and then by name", () => {
    const catalogue = connectorCatalogue([]);
    expect(new Set(catalogue.map((entry) => entry.category))).toEqual(new Set(["ai"]));
    expect(catalogue.map((entry) => entry.name)).toEqual(
      [...catalogue.map((entry) => entry.name)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("hints at a secret with its last four characters only", () => {
    expect(hintFor("sk-ant-api03-supersecret-9f2c")).toBe("9f2c");
    expect(hintFor("abcd")).toBe("abcd");
    expect(hintFor("cd")).toBe("cd");
    expect(hintFor("")).toBe("");
  });
});
