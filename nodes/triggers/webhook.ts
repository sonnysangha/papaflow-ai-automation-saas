import { z } from "zod";
import { defineNode } from "../define";

/**
 * The generic inbound webhook. Its configuration is empty on purpose: the whole contract is the
 * URL, `${APP_ORIGIN}/api/hooks/<workflowId>/<webhookSecret>`, which the config panel shows (and
 * can rotate) rather than asking anyone to type it. The secret lives on the workflow row, so a
 * rotate is one mutation and every old URL stops working at once.
 *
 * `app/api/hooks/[workflowId]/[secret]/route.ts` does the work: it compares the secret in constant
 * time, builds the delivery below and hands it to `startRun` as the trigger payload. As with the
 * Manual trigger, nothing calls `run` during a real run — `startRun` writes the trigger's step row
 * straight from that payload — so `run` exists only to keep the node complete on its own, and
 * answers with an empty delivery of exactly the shape the route produces.
 */
export const webhookTriggerNode = defineNode({
  type: "webhook.trigger",
  name: "Webhook",
  description: "Starts the workflow when something calls this workflow's URL.",
  category: "trigger",
  icon: "Webhook",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z
    .object({})
    .describe("Nothing to configure: copy the URL shown below and call it with GET or POST."),
  outputs: z.object({
    /** Parsed JSON for a JSON content type, the raw text otherwise, null for a bodyless GET. */
    body: z.any(),
    /** Lower-cased, minus `authorization` and `cookie` — a step's output is stored and displayed. */
    headers: z.record(z.string(), z.string()),
    query: z.record(z.string(), z.string()),
    method: z.string(),
  }),
  async run() {
    return { body: null, headers: {}, query: {}, method: "POST" };
  },
});
