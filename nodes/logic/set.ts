import { z } from "zod";
import { defineNode } from "../define";

/**
 * The shaping node: name a few fields, hand the next node a tidy object.
 *
 * `value` is `z.any()` rather than a string on purpose. The engine resolves `{{ … }}` before
 * `inputs.parse()`, and a value that is exactly one template keeps the raw type it pointed at —
 * `{{ http_request_1.body }}` is the object, `{{ trigger.score }}` is the number — which is the
 * whole reason to have a Set node between two connectors. A value the user typed text into is a
 * string like any other. The config panel still renders `fields` as a key/value list.
 *
 * `Object.fromEntries` rather than assignment in a loop: it defines own properties, so a field
 * named `__proto__` becomes a property of the output instead of quietly replacing its prototype.
 */
export const setNode = defineNode({
  type: "logic.set",
  name: "Set",
  description: "Build an object from key/value pairs to pass down the workflow.",
  category: "logic",
  icon: "Braces",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    fields: z
      .array(z.object({ key: z.string().min(1), value: z.any() }))
      .default([])
      .describe("Field names and their values or {{ templates }}"),
  }),
  outputs: z.record(z.string(), z.any()),
  async run({ inputs }) {
    return Object.fromEntries(inputs.fields.map((field) => [field.key, field.value]));
  },
});
