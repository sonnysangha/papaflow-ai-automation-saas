import { z } from "zod";
import { defineNode } from "../define";

/**
 * The comparisons the config panel offers. Order is the order they appear in the dropdown:
 * equality first, then text, then numbers, then the two that ignore the right-hand side.
 */
const OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "greaterThan",
  "lessThan",
  "isEmpty",
  "isNotEmpty",
  "matchesRegex",
] as const;

type Operator = (typeof OPERATORS)[number];

/**
 * Each comparison as the sentence it makes when you read the form out loud: "Check this
 * `{{ form.score }}` … is greater than … `10`". The stored value never changes — `greaterThan` is
 * in every saved graph — so this is display only, handed to the config panel through
 * `.meta({ options })` and reused by the panel's "Last time:" line so both read the same way.
 */
export const OPERATOR_LABELS: Record<Operator, string> = {
  equals: "is equal to",
  notEquals: "is not equal to",
  contains: "contains",
  notContains: "does not contain",
  greaterThan: "is greater than",
  lessThan: "is less than",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  matchesRegex: "matches pattern (regex)",
};

/** The two comparisons that ignore the right-hand side, so the panel can stop showing it. */
export const UNARY_OPERATORS: readonly Operator[] = ["isEmpty", "isNotEmpty"];

const operator = z.enum(OPERATORS);

/**
 * Both sides as numbers, or null when either one is not a finite number. `Number("")` is 0 and
 * `Number(" ")` is 0, so blank text is rejected before the conversion: an empty template must not
 * silently become zero and make `{{ missing }} lessThan 5` true.
 */
function asNumbers(left: string, right: string): [number, number] | null {
  const [l, r] = [left.trim(), right.trim()];
  if (l === "" || r === "") return null;
  const [x, y] = [Number(l), Number(r)];
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** A typo in the pattern is a configuration mistake, not a reason to fail the whole run. */
function matchesRegex(text: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

/**
 * Never throws (see the Phase 3 plan: "Condition/Switch never throw on odd inputs"). Comparisons
 * work on numbers when both sides parse as finite numbers — `"10" > "9"` is true — and on text
 * otherwise. `contains` is always textual: `1024` contains `02`.
 */
function evaluate(left: string, op: Operator, right: string): boolean {
  const pair = asNumbers(left, right);

  switch (op) {
    case "equals":
      return pair ? pair[0] === pair[1] : left === right;
    case "notEquals":
      return pair ? pair[0] !== pair[1] : left !== right;
    case "contains":
      return left.includes(right);
    case "notContains":
      return !left.includes(right);
    case "greaterThan":
      return pair ? pair[0] > pair[1] : left > right;
    case "lessThan":
      return pair ? pair[0] < pair[1] : left < right;
    case "isEmpty":
      return left.trim() === "";
    case "isNotEmpty":
      return left.trim() !== "";
    case "matchesRegex":
      return matchesRegex(left, right);
  }
}

/**
 * The branch node: one comparison, two handles. `handle()` turns the result into the edge the
 * orchestrator follows, and the nodes on the other side end the run as `skipped` rows.
 *
 * `left` and `right` are coerced strings rather than plain strings because the engine resolves
 * `{{ … }}` before `inputs.parse()`: a template that is exactly one reference keeps the raw type
 * it pointed at, so `{{ trigger.score }}` arrives here as the number 7. Coercing keeps the config
 * form a pair of text fields (the JSON Schema is `{ type: "string" }` either way) while letting
 * the comparison re-read those digits as a number.
 */
export const conditionNode = defineNode({
  type: "logic.condition",
  name: "If… then",
  description: "Send the run one way if a check passes, the other way if it fails.",
  category: "logic",
  guide: {
    summary:
      "Compare two values. If the check passes the run carries on down the “yes” arrow; if it " +
      "fails it takes the “no” arrow instead. Only one side ever runs — everything on the other " +
      "arrow is skipped.",
    outputs: { true: "yes", false: "no" },
  },
  icon: "GitBranch",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    left: z.coerce
      .string()
      .default("")
      .describe("The value to test, e.g. {{ form_1.score }}")
      .meta({ label: "Check this" }),
    operator: operator
      .default("equals")
      .describe("How the two values are compared.")
      .meta({ label: "Test", options: OPERATOR_LABELS }),
    right: z.coerce
      .string()
      .default("")
      .describe("What to compare it against, e.g. 10, another {{ template }}, or a regex pattern.")
      .meta({
        label: "Compare with",
        // "is empty" and "is not empty" only look at the left-hand side, so asking for a second
        // value there is a question with no answer.
        showWhen: {
          operator: OPERATORS.filter((entry) => !UNARY_OPERATORS.includes(entry)),
        },
      }),
  }),
  outputs: z.object({ result: z.boolean(), left: z.any(), right: z.any() }),
  handles: () => ["true", "false"],
  handle: (out) => (out.result ? "true" : "false"),
  async run({ inputs }) {
    return {
      result: evaluate(inputs.left, inputs.operator, inputs.right),
      left: inputs.left,
      right: inputs.right,
    };
  },
});
