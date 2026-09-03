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
  name: "Set values",
  description: "Give a few values a name here so later steps can reuse them.",
  category: "logic",
  guide: {
    summary:
      "Name the values you want to carry forward. Every row you add becomes one named value, and " +
      "anything after this node reads it as {{ <this node's key>.<name> }} — the key is the mono " +
      "text at the top of this panel. Nothing is sent anywhere; this node only tidies up.",
  },
  icon: "Braces",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    fields: z
      .array(z.object({ key: z.string().min(1), value: z.any() }))
      .default([])
      .describe("One row per value. Later nodes read a row as {{ <key>.<name> }}, e.g. {{ set_1.email }}.")
      .meta({ label: "Values" }),
  }),
  outputs: z.record(z.string(), z.any()),
  async run({ inputs }) {
    return Object.fromEntries(inputs.fields.map((field) => [field.key, field.value]));
  },
});
