import { describe, expect, it } from "vitest";

import {
  enumOptions,
  fieldLabel,
  fieldVisible,
  humaniseFieldName,
  optionLabel,
} from "@/components/canvas/field-label";
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

/**
 * The other half of the same problem: a `z.enum` field asks its question in the *values* the graph
 * stores, and `greaterThan` is not a thing anyone says out loud. `.meta({ options })` relabels them
 * for display only — the stored value is untouched, which is what keeps saved graphs, the Builder's
 * tool calls and `run()` working.
 */
describe("optionLabel", () => {
  it("prefers the words the node declared for a value", () => {
    const schema = { options: { greaterThan: "is greater than", isEmpty: "is empty" } };
    expect(optionLabel("greaterThan", schema)).toBe("is greater than");
    expect(optionLabel("isEmpty", schema)).toBe("is empty");
  });

  it("shows an undeclared value as itself, so GET never becomes Get", () => {
    expect(optionLabel("GET")).toBe("GET");
    expect(optionLabel("GET", {})).toBe("GET");
    expect(optionLabel("gpt-5", { options: { "gpt-4": "GPT-4" } })).toBe("gpt-5");
  });

  it("ignores a blank, non-string or non-object declaration", () => {
    expect(optionLabel("equals", { options: { equals: "  " } })).toBe("equals");
    expect(optionLabel("equals", { options: { equals: 7 } })).toBe("equals");
    expect(optionLabel("equals", { options: ["is equal to"] })).toBe("equals");
    expect(optionLabel("equals", { options: null })).toBe("equals");
  });
});

describe("enumOptions", () => {
  it("keeps the schema's order and pairs every value with its words", () => {
    expect(enumOptions(["duration", "until"], { options: { until: "until a date and time" } })).toEqual([
      { value: "duration", label: "duration" },
      { value: "until", label: "until a date and time" },
    ]);
  });
});

/**
 * `.meta({ showWhen })` is the Wait node's answer to asking the same question twice: "Seconds" and
 * "Date and time" are alternatives, and showing both is most of what made the node confusing.
 */
describe("fieldVisible", () => {
  const values = { mode: "duration", operator: "isEmpty" };

  it("shows a field that declared nothing", () => {
    expect(fieldVisible(undefined, values)).toBe(true);
    expect(fieldVisible({}, values)).toBe(true);
    expect(fieldVisible({ showWhen: null }, values)).toBe(true);
  });

  it("matches a single value", () => {
    expect(fieldVisible({ showWhen: { mode: "duration" } }, values)).toBe(true);
    expect(fieldVisible({ showWhen: { mode: "until" } }, values)).toBe(false);
  });

  it("matches any value in a list", () => {
    expect(fieldVisible({ showWhen: { operator: ["equals", "isEmpty"] } }, values)).toBe(true);
    expect(fieldVisible({ showWhen: { operator: ["equals", "contains"] } }, values)).toBe(false);
  });

  it("requires every entry to match, and treats a missing value as no match", () => {
    expect(fieldVisible({ showWhen: { mode: "duration", operator: "isEmpty" } }, values)).toBe(true);
    expect(fieldVisible({ showWhen: { mode: "duration", operator: "equals" } }, values)).toBe(false);
    expect(fieldVisible({ showWhen: { missing: "anything" } }, values)).toBe(false);
  });
});

describe("declared options and visibility", () => {
  it("reach the panel through the generated JSON Schema", () => {
    const condition = toJsonSchema(NODES["logic.condition"].inputs).properties as Record<
      string,
      { label?: unknown; options?: unknown; showWhen?: unknown; enum?: unknown[] }
    >;

    expect(fieldLabel("left", condition.left)).toBe("Check this");
    expect(optionLabel("greaterThan", condition.operator)).toBe("is greater than");
    expect(optionLabel("matchesRegex", condition.operator)).toBe("matches pattern (regex)");
    // The stored values are untouched: the enum the graph is validated against is unchanged.
    expect(condition.operator.enum).toContain("greaterThan");

    // "is empty" only looks at the left-hand side, so the panel stops asking for a right one.
    expect(fieldVisible(condition.right, { operator: "greaterThan" })).toBe(true);
    expect(fieldVisible(condition.right, { operator: "isEmpty" })).toBe(false);
    expect(fieldVisible(condition.right, { operator: "isNotEmpty" })).toBe(false);

    const wait = toJsonSchema(NODES["logic.wait"].inputs).properties as Record<
      string,
      { options?: unknown; showWhen?: unknown }
    >;

    expect(optionLabel("duration", wait.mode)).toBe("for a length of time");
    expect(fieldVisible(wait.seconds, { mode: "duration" })).toBe(true);
    expect(fieldVisible(wait.seconds, { mode: "until" })).toBe(false);
    expect(fieldVisible(wait.until, { mode: "until" })).toBe(true);
    expect(fieldVisible(wait.until, { mode: "duration" })).toBe(false);
  });
});
