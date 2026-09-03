import { z } from "zod";

import { defineNode } from "../define";

/**
 * The hosted form trigger: PapaFlow renders a public page at `/f/<workflowId>` from the field list
 * configured here, and a submission starts the run.
 *
 * The whole contract is this node's `inputs`. `app/f/[workflowId]/page.tsx` reads them back through
 * `getPublicForm` to draw the form, and `app/api/forms/[workflowId]/route.ts` reads the same object
 * to build the zod schema it validates a submission against — so a field that is not configured
 * here cannot be submitted, and the browser never gets to decide what is valid.
 *
 * As with every other trigger, nothing calls `run` during a real run: the submitted payload *is*
 * the trigger's output (`startRun` writes the step row straight from it). It stays here so the node
 * is complete on its own, and answers with exactly the shape the route produces.
 */
export const formTriggerNode = defineNode({
  type: "form.trigger",
  name: "Form",
  description: "Starts the workflow when someone submits your hosted form.",
  guide: {
    summary:
      "PapaFlow hosts this form at /f/<workflow id>. Open this link to fill in the form. On localhost it works in your browser; publish the workflow so submissions start runs — a draft form still renders, with a banner saying the submit button goes nowhere yet.",
  },
  category: "trigger",
  icon: "ClipboardList",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    title: z.string().default("Contact us").describe("Heading shown on the public form page"),
    description: z.string().optional().describe("Optional line under the heading"),
    fields: z
      .array(
        z.object({
          /**
           * Doubles as the payload key, so it has to be a template-safe identifier:
           * `{{ form_trigger_1.values.email }}` only works when the name is one.
           */
          name: z
            .string()
            .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Letters, digits and underscores; cannot start with a digit")
            .describe("Key this answer appears under in the payload"),
          label: z.string().describe("What the visitor sees above the field"),
          type: z.enum(["text", "email", "textarea", "number", "select"]),
          required: z.boolean().default(true),
          options: z.array(z.string()).optional().describe("Choices, for a select field"),
        }),
      )
      .min(1)
      .default([
        { name: "email", label: "Email", type: "email", required: true },
        { name: "message", label: "Message", type: "textarea", required: true },
      ])
      .describe("The fields to ask for, in order"),
    submitLabel: z.string().default("Send").describe("Text on the submit button"),
  }),
  outputs: z.object({
    /** One key per configured field: `{{ form_trigger_1.values.email }}`. */
    values: z.record(z.string(), z.any()),
    submittedAt: z.number(),
  }),
  async run() {
    // A submission never reaches here (the route hands its payload to `startRun` directly), so the
    // passthrough answers with an empty delivery of exactly the shape the route produces.
    return { values: {}, submittedAt: Date.now() };
  },
});

/** The form's configuration once parsed: what the page renders and the route validates against. */
export type FormSpec = z.infer<typeof formTriggerNode.inputs>;

/** One configured field. */
export type FormField = FormSpec["fields"][number];

/**
 * The stored graph is `v.any()` on the Convex side, so both public surfaces run whatever the canvas
 * saved through the node's own schema before trusting it — defaults filled in, junk refused. `null`
 * means "there is no usable form here", which the page and the route both answer with a 404.
 */
export function parseFormSpec(form: unknown): FormSpec | null {
  const parsed = formTriggerNode.inputs.safeParse(form ?? {});
  return parsed.success ? parsed.data : null;
}
