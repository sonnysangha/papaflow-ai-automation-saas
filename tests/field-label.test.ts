import { describe, expect, it } from "vitest";

import { fieldLabel, humaniseFieldName } from "@/components/canvas/field-label";
import { NODES } from "@/nodes/registry";
import { toJsonSchema } from "@/nodes/schema";

/**
 * The config panel's labels. Every control is generated from a node's zod `inputs`, so without
 * this the form asks for `connectionId` and `authHeader` — accurate, and unreadable.
 */
describe("humaniseFieldName", () => {
  it("splits camelCase into a sentence", () => {
    expect(humaniseFieldName("authHeader")).toBe("Auth header");
    expect(humaniseFieldName("submitLabel")).toBe("Submit label");
    expect(humaniseFieldName("parseMode")).toBe("Parse mode");
    expect(humaniseFieldName("embedDescription")).toBe("Embed description");
  });

  it("drops a trailing Id, because the field asks for the thing and not its id", () => {
    expect(humaniseFieldName("connectionId")).toBe("Connection");
    expect(humaniseFieldName("chatId")).toBe("Chat");
    expect(humaniseFieldName("baseId")).toBe("Base");
    expect(humaniseFieldName("dataSourceId")).toBe("Data source");
  });

  it("keeps a name that is only an id", () => {
    expect(humaniseFieldName("id")).toBe("ID");
  });

  it("shouts acronyms wherever they fall", () => {
    expect(humaniseFieldName("url")).toBe("URL");
    expect(humaniseFieldName("webhookUrl")).toBe("Webhook URL");
    expect(humaniseFieldName("apiKey")).toBe("API key");
    expect(humaniseFieldName("HTTPMethod")).toBe("HTTP method");
  });

  it("handles single words, snake_case and empty names", () => {
    expect(humaniseFieldName("body")).toBe("Body");
    expect(humaniseFieldName("to")).toBe("To");
    expect(humaniseFieldName("auth_header")).toBe("Auth header");
    expect(humaniseFieldName("")).toBe("");
  });
});

describe("fieldLabel", () => {
  it("falls back to the humanised name", () => {
    expect(fieldLabel("authHeader")).toBe("Auth header");
    expect(fieldLabel("authHeader", {})).toBe("Auth header");
    expect(fieldLabel("authHeader", null)).toBe("Auth header");
  });

  it("prefers a label the node declared with .meta({ label })", () => {
    expect(fieldLabel("everyMinutes", { label: "Every (minutes)" })).toBe("Every (minutes)");
  });

  it("ignores a blank or non-string label", () => {
    expect(fieldLabel("authHeader", { label: "   " })).toBe("Auth header");
    expect(fieldLabel("authHeader", { label: 7 })).toBe("Auth header");
  });

  it("never returns an empty label for a name that has one", () => {
    expect(fieldLabel("_")).toBe("_");
  });
});

/**
 * The `.meta({ label })` overrides only work if they survive `z.toJSONSchema()` — the same route
 * `picker` takes. This is the one place that would notice zod dropping unknown metadata keys.
 */
describe("declared labels", () => {
  it("reaches the panel through the generated JSON Schema", () => {
    const schema = toJsonSchema(NODES["schedule.trigger"].inputs);
    const properties = schema.properties as Record<string, { label?: unknown }>;

    expect(fieldLabel("everyMinutes", properties.everyMinutes)).toBe("Every (minutes)");
    expect(fieldLabel("mode", properties.mode)).toBe("Repeat");
  });
});
