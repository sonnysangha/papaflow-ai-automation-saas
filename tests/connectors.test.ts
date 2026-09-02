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
  it("keys every connector by its own unique provider (ten AI + chat, data, email, payments)", () => {
    const entries = Object.entries(CONNECTORS);
    expect(entries).toHaveLength(21);

    const providers = entries.map(([, def]) => def.provider);
    expect(new Set(providers).size).toBe(providers.length);
    expect(providers.filter((p) => CONNECTORS[p].category === "ai").sort()).toEqual(AI_PROVIDERS);
    expect(providers).toContain("telegram");
    expect(providers).toContain("stripe");
    for (const provider of ["slack", "discord-webhook", "discord-bot", "teams", "notion", "airtable", "linear", "github", "resend"]) {
      expect(providers).toContain(provider);
    }

    for (const [key, def] of entries) {
      expect(def.provider).toBe(key);
    }
  });

  it("throws at module load when two definitions share a provider", () => {
    const twin = CONNECTORS.openai;
    expect(() => buildConnectorRegistry([twin, twin])).toThrow(/openai/);
  });

  it("describes every AI connector as a single free-to-add api key", () => {
    for (const def of Object.values(CONNECTORS).filter((d) => d.category === "ai")) {
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

    expect(catalogue).toHaveLength(21);
    expect(findFunctions(catalogue)).toEqual([]);
    expect(JSON.parse(JSON.stringify(catalogue))).toEqual(catalogue);

    for (const entry of catalogue) {
      expect(Object.keys(entry).sort()).toEqual(CATALOGUE_KEYS);
      if (entry.category === "ai") expect(entry.fields[0].name).toBe("apiKey");
    }
  });

  it("marks every connector allowed for an org with no paid features", () => {
    const catalogue = connectorCatalogue([]);
    expect(catalogue).toHaveLength(21);
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
    expect(new Set(catalogue.map((entry) => entry.category))).toEqual(new Set(["ai", "chat", "data", "email", "payments"]));
    const order = ["ai", "chat", "data", "email", "payments"];
    const categories = catalogue.map((entry) => order.indexOf(entry.category));
    expect(categories).toEqual([...categories].sort((a, b) => a - b));
    const aiNames = catalogue.filter((e) => e.category === "ai").map((entry) => entry.name);
    expect(aiNames).toEqual([...aiNames].sort((a, b) => a.localeCompare(b)));
  });

  it("hints at a secret with its last four characters only", () => {
    expect(hintFor("sk-ant-api03-supersecret-9f2c")).toBe("9f2c");
    expect(hintFor("abcd")).toBe("abcd");
    expect(hintFor("cd")).toBe("cd");
    expect(hintFor("")).toBe("");
  });
});
