import { z } from "zod";

import { defineNode } from "../define";

/**
 * Starts a run when the connected Stripe webhook endpoint delivers an event.
 *
 * `app/api/events/stripe/[connectionId]/route.ts` verifies the `Stripe-Signature` header against
 * this connection's `whsec_…`, dedupes on `event.id` and only then starts a run — so `run` here is
 * never called during a real run (the trigger's payload *is* its output; see
 * `workflows/run-graph.ts`), and is left as an untouched passthrough.
 *
 * An empty `eventTypes` means "every event this endpoint receives"; the filtering itself belongs to
 * the route, which knows the event before any run exists.
 */
export const stripeEventTriggerNode = defineNode({
  type: "stripe.event",
  name: "Stripe event",
  description: "Starts the workflow when Stripe sends an event.",
  category: "trigger",
  icon: "CreditCard",
  credential: "stripe",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string().describe("Stripe webhook connection to listen on"),
    eventTypes: z
      .array(z.string())
      .default([])
      .describe("Event types to start on, e.g. payment_intent.succeeded. Empty means all."),
  }),
  outputs: z.object({
    event: z.any(),
    type: z.string(),
    object: z.any(),
  }),
  async run() {
    return { event: {}, type: "", object: {} };
  },
});
