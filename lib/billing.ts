import { clerkClient } from "@clerk/nextjs/server";

import { DEFAULT_PLAN, isPlanSlug, type PlanSlug } from "@/lib/plans";

/**
 * The org's plan, for callers with no session.
 *
 * Clerk is the source of truth for billing (CLAUDE.md rule 10). A server action reads the plan off
 * the session token's `pla` claim, but an inbound webhook, a form submission or the scheduler has
 * no session at all — so they ask the Clerk Backend API, and `startRun` snapshots the answer onto
 * the execution.
 *
 * `clerkClient.billing` is a public-beta API: `getOrganizationBillingSubscription(orgId)` returns a
 * `BillingSubscription` whose `subscriptionItems[]` each carry a `status` and a `plan` (verified
 * against `node_modules/@clerk/backend/dist/api/endpoints/BillingApi.d.ts`).
 */

/** How long one org's answer is reused. Short enough that an upgrade is live within a minute. */
const TTL_MS = 60_000;

/**
 * Structural, not `BillingSubscription`: this file should not break when a beta API grows a field,
 * and the tests hand in plain objects. Everything the real resource returns is assignable.
 */
type SubscriptionItemLike = { status?: string | null; plan?: { slug?: string | null } | null };
type SubscriptionLike = { subscriptionItems?: readonly SubscriptionItemLike[] | null };

/**
 * One process-local entry per org. Deliberately not a shared cache: a Vercel instance that has
 * never seen this org just pays for one API call, and a stale entry can only be 60 s old.
 */
const cache = new Map<string, { plan: PlanSlug; expiresAt: number }>();

/**
 * The plan a subscription is on: the `active` item if there is one, otherwise a `past_due` item —
 * a failing card downgrades the org when Clerk says so, not when the first payment is late.
 * Anything else (no items, a plan slug this build does not know) is the free plan.
 */
function planFromSubscription(subscription: SubscriptionLike): PlanSlug {
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
 * Never throws: a billing outage must not stop an inbound delivery from starting a run, so any
 * error logs once and answers `free_org` — the same answer an org with no subscription gets. The
 * fallback is cached too, so a hard outage costs one API call a minute per org rather than one per
 * delivery.
 */
export async function getOrgPlan(orgId: string): Promise<PlanSlug> {
  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.plan;

  let plan: PlanSlug = DEFAULT_PLAN;
  try {
    const client = await clerkClient();
    plan = planFromSubscription(await client.billing.getOrganizationBillingSubscription(orgId));
  } catch (cause) {
    console.error(
      `billing: could not read the plan for ${orgId}; falling back to ${DEFAULT_PLAN}`,
      cause instanceof Error ? cause.message : cause,
    );
    plan = DEFAULT_PLAN;
  }

  cache.set(orgId, { plan, expiresAt: Date.now() + TTL_MS });
  return plan;
}

/** Drops cached plans — one org's, or all of them. For tests, and for a future billing webhook. */
export function clearOrgPlanCache(orgId?: string): void {
  if (orgId === undefined) cache.clear();
  else cache.delete(orgId);
}
