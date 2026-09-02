// Server only. Reads Clerk Billing from a process that has no Next.js request context.
import { createClerkClient } from "@clerk/backend";

import { DEFAULT_PLAN, isPlanSlug, type PlanSlug } from "@/lib/plans";

/**
 * The org's plan, for the eve agents.
 *
 * `lib/billing.ts#getOrgPlan` answers the same question for the app and the engine, but it imports
 * `clerkClient` from `@clerk/nextjs/server`, which reaches `next/headers` — fine inside a Next
 * function, wrong inside the eve service, which is its own Nitro build with no request context.
 * So this is the same lookup against `@clerk/backend` directly, the way
 * `lib/connections-engine.ts` is the same Convex conversation without the workflow imports.
 *
 * Clerk stays the source of truth for billing (CLAUDE.md rule 10): the plan is *not* read from
 * anything PapaFlow stores. The session token's `pla` claim would be cheaper, but it is minted for
 * up to a minute and a Builder session outlives that, so the gate asks Clerk.
 */

/** How long one org's answer is reused, matching `lib/billing.ts`. */
const TTL_MS = 60_000;

/** Structural, so a beta API growing a field cannot break this and tests can hand in plain objects. */
type SubscriptionItemLike = { status?: string | null; plan?: { slug?: string | null } | null };
type SubscriptionLike = { subscriptionItems?: readonly SubscriptionItemLike[] | null };

const cache = new Map<string, { plan: PlanSlug; expiresAt: number }>();

/**
 * The plan a subscription is on: the `active` item if there is one, otherwise a `past_due` item.
 * Anything else — no items, a slug this build does not know — is the free plan.
 */
export function planFromSubscription(subscription: SubscriptionLike): PlanSlug {
  const items = subscription.subscriptionItems ?? [];

  const slugFor = (status: string): PlanSlug | undefined => {
    for (const item of items) {
      if (item.status !== status) continue;
      const slug = item.plan?.slug;
      if (typeof slug === "string" && isPlanSlug(slug)) return slug;
    }
    return undefined;
  };

  return slugFor("active") ?? slugFor("past_due") ?? DEFAULT_PLAN;
}

/**
 * The org's Clerk plan slug, cached for 60 s per org.
 *
 * Never throws. A billing outage answers `free_org`, which closes the Builder rather than opening
 * it — the safe direction for a paid feature — and the fallback is cached too, so an outage costs
 * one API call a minute per org instead of one per tool call.
 */
export async function orgPlanFromClerk(orgId: string): Promise<PlanSlug> {
  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.plan;

  let plan: PlanSlug = DEFAULT_PLAN;
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
    const client = createClerkClient({ secretKey });
    plan = planFromSubscription(await client.billing.getOrganizationBillingSubscription(orgId));
  } catch (cause) {
    console.error(
      `billing-engine: could not read the plan for ${orgId}; falling back to ${DEFAULT_PLAN}`,
      cause instanceof Error ? cause.message : cause,
    );
    plan = DEFAULT_PLAN;
  }

  cache.set(orgId, { plan, expiresAt: Date.now() + TTL_MS });
  return plan;
}

/** Drops cached plans — one org's, or all of them. For tests. */
export function clearEnginePlanCache(orgId?: string): void {
  if (orgId === undefined) cache.clear();
  else cache.delete(orgId);
}
