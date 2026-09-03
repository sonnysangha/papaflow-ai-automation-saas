import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  buildConnectorRegistry,
  connectorCatalogue,
  hintFor,
} from "@/connectors/registry";
import { slackAppManifest } from "@/connectors/slack";
import { featuresForPlan } from "@/lib/plans";

/** The four connectors Phase 11 put behind `pro_connectors`. Sorted, for direct comparison. */
const PRO_PROVIDERS = ["airtable", "linear", "notion", "slack"];

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

/** Only a connector with a `setup` block carries the extra key, and only Slack has one. */
const SETUP_PROVIDERS = ["slack"];

const CATALOGUE_KEYS_WITH_SETUP = [...CATALOGUE_KEYS, "setup"].sort();

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

  it("describes every AI connector as a free-to-add api key, and asks for nothing else it can avoid", () => {
    for (const def of Object.values(CONNECTORS).filter((d) => d.category === "ai")) {
      expect(def.category).toBe("ai");
      expect(def.kind).toBe("apiKey");
      expect(def.requiresFeature).toBeNull();
      expect(def.name).toBeTruthy();
      expect(def.icon).toBeTruthy();
      expect(def.docsUrl).toMatch(/^https:\/\//);
      expect(typeof def.test).toBe("function");

      // One secret, always first, always the key itself.
      expect(def.fields[0]).toMatchObject({ name: "apiKey", label: "API key", kind: "secret" });
      expect(def.fields[0].placeholder).toBeTruthy();
      expect(def.fields.filter((field) => field.kind === "secret")).toHaveLength(1);

      // Anything past it is a provider's own requirement (Anthropic's workspace id for a key that
      // is not tied to one workspace) and must be optional, or pasting a key stops being one step.
      for (const field of def.fields.slice(1)) {
        expect(field.required).toBe(false);
        expect(field.help).toBeTruthy();
      }
    }
  });

  it("builds a catalogue that carries no functions across the wire", () => {
    const catalogue = connectorCatalogue([]);

    expect(catalogue).toHaveLength(21);
    expect(findFunctions(catalogue)).toEqual([]);
    expect(JSON.parse(JSON.stringify(catalogue))).toEqual(catalogue);

    for (const entry of catalogue) {
      expect(Object.keys(entry).sort()).toEqual(
        SETUP_PROVIDERS.includes(entry.provider) ? CATALOGUE_KEYS_WITH_SETUP : CATALOGUE_KEYS,
      );
      if (entry.category === "ai") expect(entry.fields[0].name).toBe("apiKey");
    }
  });

  it("carries Slack's setup steps and app manifest, and nobody else's", () => {
    const catalogue = connectorCatalogue(featuresForPlan("pro"));
    const slack = catalogue.find((entry) => entry.provider === "slack");

    expect(slack?.setup?.title).toBeTruthy();
    expect(slack?.setup?.steps.length).toBeGreaterThan(0);
    expect(slack?.setup?.manifest).toEqual(slackAppManifest());

    for (const entry of catalogue.filter((e) => !SETUP_PROVIDERS.includes(e.provider))) {
      expect(entry.setup).toBeUndefined();
    }
  });

  it("copies the setup block so the catalogue cannot mutate the connector", () => {
    const slack = connectorCatalogue([]).find((entry) => entry.provider === "slack");
    slack!.setup!.steps[0] = "tampered";
    (slack!.setup!.manifest as { display_information: { name: string } }).display_information.name =
      "tampered";

    const fresh = connectorCatalogue([]).find((entry) => entry.provider === "slack");
    expect(fresh?.setup?.steps[0]).not.toBe("tampered");
    expect(fresh?.setup?.manifest).toEqual(slackAppManifest());
  });

  it("dims exactly the Pro connectors for an org with no paid features", () => {
    const catalogue = connectorCatalogue([]);
    expect(catalogue).toHaveLength(21);

    const blocked = catalogue.filter((entry) => !entry.allowed).map((entry) => entry.provider);
    expect(blocked.sort()).toEqual(PRO_PROVIDERS);

    for (const entry of catalogue) {
      // The only feature any connector asks for today is `pro_connectors`; everything else — the
      // AI providers, GitHub, Discord, Teams, Telegram, Resend — is free.
      expect(entry.requiresFeature).toBe(
        PRO_PROVIDERS.includes(entry.provider) ? "pro_connectors" : null,
      );
      expect(entry.allowed).toBe(!PRO_PROVIDERS.includes(entry.provider));
    }
  });

  it("allows every connector on Pro", () => {
    const catalogue = connectorCatalogue(featuresForPlan("pro"));
    expect(catalogue).toHaveLength(21);
    for (const entry of catalogue) expect(entry.allowed).toBe(true);
  });

  it("gates a connector on the feature it names, not on the plan", () => {
    // `core_connectors` alone is what `free_org` carries: it must not unlock the Pro four.
    const core = connectorCatalogue(["core_connectors"]);
    expect(core.filter((entry) => !entry.allowed).map((entry) => entry.provider).sort()).toEqual(
      PRO_PROVIDERS,
    );

    // And the feature alone is enough, whichever plan happens to grant it.
    const pro = connectorCatalogue(["pro_connectors"]);
    expect(pro.every((entry) => entry.allowed)).toBe(true);
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
