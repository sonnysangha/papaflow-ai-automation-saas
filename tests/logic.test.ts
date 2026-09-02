import { describe, expect, it } from "vitest";

import type { RunContext } from "@/nodes/define";
import { conditionNode } from "@/nodes/logic/condition";
import { setNode } from "@/nodes/logic/set";
import { switchNode } from "@/nodes/logic/switch";

/**
 * The logic nodes are pure: no fetch, no credential, no environment. They are also the nodes most
 * exposed to whatever `resolveTemplates` hands them, so every test goes through `inputs.parse()` —
 * a template that resolved to a number or an object arrives here exactly like that.
 */
function ctx<I>(inputs: I): RunContext<I> {
  return { inputs, orgId: "org_test", executionId: "exec_test", nodeId: "node_test" };
}

/** One comparison, from raw (possibly non-string) values through the schema to the result. */
async function compare(left: unknown, operator: string, right?: unknown): Promise<boolean> {
  const inputs = conditionNode.inputs.parse({ left, operator, right });
  const { result } = await conditionNode.run(ctx(inputs));
  return result;
}

async function route(value: unknown, cases: string[]): Promise<string> {
  const inputs = switchNode.inputs.parse({ value, cases });
  const { matched } = await switchNode.run(ctx(inputs));
  return matched;
}

async function build(fields: { key: string; value: unknown }[]): Promise<Record<string, unknown>> {
  const inputs = setNode.inputs.parse({ fields });
  return await setNode.run(ctx(inputs));
}

describe("logic.condition", () => {
  it("is a logic node with two branch handles", () => {
    expect(conditionNode.type).toBe("logic.condition");
    expect(conditionNode.category).toBe("logic");
    expect(conditionNode.credential).toBeNull();
    expect(conditionNode.requiresFeature).toBeNull();
    expect(conditionNode.handles?.(conditionNode.inputs.parse({}))).toEqual(["true", "false"]);
  });

  it("follows the true handle when the comparison holds and the false handle when it does not", () => {
    expect(conditionNode.handle?.({ result: true, left: "a", right: "a" })).toBe("true");
    expect(conditionNode.handle?.({ result: false, left: "a", right: "b" })).toBe("false");
  });

  it("compares equal and unequal values as text", async () => {
    await expect(compare("gold", "equals", "gold")).resolves.toBe(true);
    await expect(compare("gold", "equals", "Gold")).resolves.toBe(false);
    await expect(compare("gold", "notEquals", "silver")).resolves.toBe(true);
    await expect(compare("gold", "notEquals", "gold")).resolves.toBe(false);
  });

  it("coerces both sides to numbers when both parse as finite numbers", async () => {
    // The whole point: as text `"10" > "9"` is false, as numbers it is true.
    await expect(compare("10", "greaterThan", "9")).resolves.toBe(true);
    await expect(compare("9", "greaterThan", "10")).resolves.toBe(false);
    await expect(compare("9", "lessThan", "10")).resolves.toBe(true);
    await expect(compare("1.0", "equals", "1")).resolves.toBe(true);
    await expect(compare(" 7 ", "greaterThan", "5")).resolves.toBe(true);
  });

  it("falls back to string comparison when either side is not a number", async () => {
    await expect(compare("b", "greaterThan", "a")).resolves.toBe(true);
    await expect(compare("a", "greaterThan", "b")).resolves.toBe(false);
    await expect(compare("apple", "lessThan", "banana")).resolves.toBe(true);
    // Empty text is not the number zero.
    await expect(compare("", "lessThan", "5")).resolves.toBe(true);
    await expect(compare("5", "greaterThan", "")).resolves.toBe(true);
    // Infinity and NaN are not finite numbers either.
    await expect(compare("Infinity", "greaterThan", "9")).resolves.toBe(true);
  });

  it("checks substrings for contains and notContains", async () => {
    await expect(compare("hello world", "contains", "world")).resolves.toBe(true);
    await expect(compare("hello world", "contains", "mars")).resolves.toBe(false);
    await expect(compare("hello world", "notContains", "mars")).resolves.toBe(true);
    await expect(compare("hello world", "notContains", "world")).resolves.toBe(false);
    // No numeric coercion here: `contains` is always about text.
    await expect(compare("1024", "contains", "02")).resolves.toBe(true);
  });

  it("treats empty text, whitespace and a missing value as empty", async () => {
    await expect(compare("", "isEmpty")).resolves.toBe(true);
    await expect(compare("   ", "isEmpty")).resolves.toBe(true);
    // An unresolved `{{ … }}` resolves to "" and a missing key defaults to "": both are empty.
    await expect(compare(undefined, "isEmpty")).resolves.toBe(true);
    await expect(compare("x", "isEmpty")).resolves.toBe(false);
    await expect(compare("x", "isNotEmpty")).resolves.toBe(true);
    await expect(compare("", "isNotEmpty")).resolves.toBe(false);
  });

  it("matches a regular expression and never throws on a broken one", async () => {
    await expect(compare("hello", "matchesRegex", "^he")).resolves.toBe(true);
    await expect(compare("hello", "matchesRegex", "^xy")).resolves.toBe(false);
    await expect(compare("a@b.com", "matchesRegex", "^[^@]+@[^@]+\\.[a-z]+$")).resolves.toBe(true);
    // An unfinished group is a configuration typo, not a run-ending error.
    await expect(compare("hello", "matchesRegex", "(")).resolves.toBe(false);
    await expect(compare("hello", "matchesRegex", "[a-")).resolves.toBe(false);
  });

  it("accepts a template that resolved to a number or a boolean", async () => {
    // `{{ trigger.score }}` arrives as 7, not "7": the schema coerces so the node still runs.
    await expect(compare(7, "greaterThan", 5)).resolves.toBe(true);
    await expect(compare(true, "equals", "true")).resolves.toBe(true);
    expect(conditionNode.inputs.parse({ left: 7 }).left).toBe("7");
  });

  it("echoes both sides on the output so the run inspector shows what was compared", async () => {
    const inputs = conditionNode.inputs.parse({ left: "10", operator: "greaterThan", right: "9" });
    const output = await conditionNode.run(ctx(inputs));

    expect(output).toEqual({ result: true, left: "10", right: "9" });
    expect(conditionNode.outputs.parse(output)).toEqual(output);
  });

  it("defaults to an equals comparison of two empty strings", async () => {
    const inputs = conditionNode.inputs.parse({});
    expect(inputs).toEqual({ left: "", operator: "equals", right: "" });
    await expect(conditionNode.run(ctx(inputs))).resolves.toMatchObject({ result: true });
  });

  it("rejects an operator it does not implement", () => {
    expect(conditionNode.inputs.safeParse({ operator: "isDivisibleBy" }).success).toBe(false);
  });
});

describe("logic.switch", () => {
  it("is a logic node whose handles are its cases plus default", () => {
    expect(switchNode.type).toBe("logic.switch");
    expect(switchNode.category).toBe("logic");
    expect(switchNode.handles?.({ value: "", cases: ["gold", "silver"] })).toEqual([
      "gold",
      "silver",
      "default",
    ]);
    // A switch with no cases still has somewhere to send the run.
    expect(switchNode.handles?.(switchNode.inputs.parse({}))).toEqual(["default"]);
  });

  it("follows the handle named by the matched case", () => {
    expect(switchNode.handle?.({ matched: "gold", value: "gold" })).toBe("gold");
    expect(switchNode.handle?.({ matched: "default", value: "bronze" })).toBe("default");
  });

  it("matches a case exactly, ignoring surrounding whitespace", async () => {
    await expect(route("gold", ["gold", "silver"])).resolves.toBe("gold");
    await expect(route("  silver  ", ["gold", "silver"])).resolves.toBe("silver");
    // The handle id is the case as written, so an untrimmed case still matches its own edge.
    await expect(route("gold", [" gold "])).resolves.toBe(" gold ");
  });

  it("falls through to default on a near miss", async () => {
    // Case-sensitive on purpose: a Switch routes on exact values, not on intent.
    await expect(route("Gold", ["gold"])).resolves.toBe("default");
    await expect(route("bronze", ["gold", "silver"])).resolves.toBe("default");
    await expect(route("", ["gold"])).resolves.toBe("default");
    await expect(route("gold", [])).resolves.toBe("default");
  });

  it("takes the first matching case when the same case is listed twice", async () => {
    await expect(route("gold", ["gold", "gold"])).resolves.toBe("gold");
  });

  it("echoes the value it routed on and accepts a template that resolved to a number", async () => {
    const inputs = switchNode.inputs.parse({ value: 404, cases: ["404", "500"] });
    const output = await switchNode.run(ctx(inputs));

    expect(output).toEqual({ matched: "404", value: "404" });
    expect(switchNode.outputs.parse(output)).toEqual(output);
  });

  it("rejects an empty case: it could never be wired to a handle", () => {
    expect(switchNode.inputs.safeParse({ cases: [""] }).success).toBe(false);
    expect(switchNode.inputs.safeParse({ cases: ["ok"] }).success).toBe(true);
  });
});

describe("logic.set", () => {
  it("is a logic node with a single default output", () => {
    expect(setNode.type).toBe("logic.set");
    expect(setNode.category).toBe("logic");
    expect(setNode.handles).toBeUndefined();
    expect(setNode.handle).toBeUndefined();
  });

  it("builds an object from the key/value pairs", async () => {
    await expect(
      build([
        { key: "name", value: "Ada" },
        { key: "email", value: "ada@example.com" },
      ]),
    ).resolves.toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("keeps the raw type of a value that was exactly one template", async () => {
    // The engine resolved `{{ http_request_1.body }}` to the object itself before parsing, and
    // `{{ trigger.score }}` to a number: neither is flattened back into text here.
    const output = await build([
      { key: "body", value: { items: [1, 2], ok: true } },
      { key: "score", value: 7 },
      { key: "flag", value: false },
      { key: "nothing", value: null },
      { key: "list", value: ["a", "b"] },
      { key: "text", value: "score is 7" },
    ]);

    expect(output).toEqual({
      body: { items: [1, 2], ok: true },
      score: 7,
      flag: false,
      nothing: null,
      list: ["a", "b"],
      text: "score is 7",
    });
    expect(typeof output.score).toBe("number");
    expect(setNode.outputs.parse(output)).toEqual(output);
  });

  it("defaults to an empty object", async () => {
    expect(setNode.inputs.parse({})).toEqual({ fields: [] });
    await expect(build([])).resolves.toEqual({});
  });

  it("lets a later field win when a key is repeated", async () => {
    await expect(
      build([
        { key: "status", value: "draft" },
        { key: "status", value: "sent" },
      ]),
    ).resolves.toEqual({ status: "sent" });
  });

  it("writes a __proto__ field as an own property rather than a prototype", async () => {
    const output = await build([{ key: "__proto__", value: { polluted: true } }]);

    expect(Object.hasOwn(output, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects a field with no key", () => {
    expect(setNode.inputs.safeParse({ fields: [{ key: "", value: "x" }] }).success).toBe(false);
  });
});
