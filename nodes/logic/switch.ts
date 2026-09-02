import { z } from "zod";
import { defineNode } from "../define";

/** The handle every unmatched value leaves through. Always present, even with no cases. */
const DEFAULT_CASE = "default";

/**
 * The many-way branch: one value, one handle per case, plus `default`.
 *
 * `handles(inputs)` is what the canvas draws, so the handle ids are the case strings exactly as
 * the user typed them — `matched` returns the case as written, not the trimmed form it was
 * compared with, or the edge would have nowhere to land. Matching itself trims both sides (a
 * template picks up whitespace easily) and stays case-sensitive: a Switch routes on exact values.
 *
 * `value` is a coerced string for the same reason as Condition's operands: the engine resolves
 * `{{ … }}` before `inputs.parse()`, so `{{ http_request_1.status }}` arrives as the number 404.
 */
export const switchNode = defineNode({
  type: "logic.switch",
  name: "Switch",
  description: "Route the run down one branch per matching value, or default.",
  category: "logic",
  icon: "Split",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    value: z.coerce.string().default("").describe("Value to route on, usually a {{ template }}"),
    cases: z.array(z.string().min(1)).default([]).describe("One branch handle per case"),
  }),
  outputs: z.object({ matched: z.string(), value: z.any() }),
  handles: (inputs) => [...inputs.cases, DEFAULT_CASE],
  handle: (out) => out.matched,
  async run({ inputs }) {
    const value = inputs.value.trim();
    const matched = inputs.cases.find((entry) => entry.trim() === value) ?? DEFAULT_CASE;
    return { matched, value: inputs.value };
  },
});
