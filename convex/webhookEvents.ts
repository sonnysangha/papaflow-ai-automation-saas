import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

/**
 * Delivery dedupe for inbound webhooks.
 *
 * Every provider that retries — Stripe on a slow 200, GitHub on a redelivery, Clerk via svix —
 * sends the same event more than once, and each delivery would otherwise start its own run. The
 * `(source, eventId)` pair is claimed here in one transaction, so of two simultaneous deliveries
 * exactly one wins and the other is told it is a duplicate.
 *
 * Reached from the routes through the secret-guarded `api.engine.recordWebhookEvent`.
 */
export const record = internalMutation({
  args: { source: v.string(), eventId: v.string() },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, { source, eventId }) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_source_event", (q) => q.eq("source", source).eq("eventId", eventId))
      // `.first()` rather than `.unique()`: a duplicate row is a reason to say "duplicate", never
      // a reason to throw and make the provider retry the delivery again.
      .first();

    if (existing) return { duplicate: true };

    await ctx.db.insert("webhookEvents", { source, eventId, receivedAt: Date.now() });
    return { duplicate: false };
  },
});
