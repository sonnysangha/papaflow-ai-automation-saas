import { DEFAULT_PLAN, isPlanSlug, PLAN_ORDER, type PlanSlug } from "@/lib/plans";

/**
 * Everything the plan cards decide *before* React is involved: which call to action a card should
 * carry, what price to print on it, and which plan the organisation is actually on.
 *
 * It lives apart from the components because all three answers depend on Clerk data that only
 * exists at runtime (`usePlans` / `useSubscription`), and none of them can be checked in a browser
 * without a live billing instance. Pure functions over plain objects can be checked in a test.
 *
 * Nothing here is a gate. A card offering "Upgrade to Pro" is an offer; the refusals live in
 * `has()` on the server, in Convex mutations and in `runNode` (CLAUDE.md rule 3).
 */

/** Clerk's own name for a billing period. */
export type PlanPeriod = "month" | "annual";

export type PlanCta =
  /** No session: the visitor signs up before there is an organisation to bill. */
  | { kind: "sign_up" }
  /** Signed in with no active organisation — plans are per org, so one has to be chosen first. */
  | { kind: "select_org" }
  /** The plan this organisation is already on. */
  | { kind: "current" }
  /** The Free card while the org is on a paid plan: leaving is Clerk's subscription drawer. */
  | { kind: "manage" }
  /** A paid plan the org is not on. `planId` is Clerk's instance-specific `cplan_…`. */
  | { kind: "checkout"; planId: string; period: PlanPeriod }
  /** Clerk has not returned an id for this slug, so there is nothing to check out. */
  | { kind: "unavailable" };

export type PlanCtaInput = {
  plan: PlanSlug;
  /** The org's active plan slug, from `useSubscription`. `null`/`undefined` = not known yet. */
  currentSlug: string | null | undefined;
  signedIn: boolean;
  hasOrg: boolean;
  /** Clerk's plan id for `plan`, matched on slug. Missing while `usePlans` loads, or on error. */
  clerkPlanId: string | null | undefined;
  period: PlanPeriod;
  /**
   * Whether Clerk has an annual price for this plan. `team` has none on this instance, so choosing
   * "Bill yearly" must not hide its button — the checkout opens on the monthly price instead.
   * Defaults to `true`; when there is no Clerk plan at all the CTA is `unavailable` anyway.
   */
  hasAnnualPrice?: boolean;
};

/**
 * The one call to action a card should render.
 *
 * The order matters: a signed-out visitor never sees a plan comparison they cannot act on, and a
 * signed-in one with no active organisation is sent to pick one rather than into a checkout that
 * `CheckoutButton for="organization"` would throw on.
 */
export function planCta({
  plan,
  currentSlug,
  signedIn,
  hasOrg,
  clerkPlanId,
  period,
  hasAnnualPrice = true,
}: PlanCtaInput): PlanCta {
  if (!signedIn) return { kind: "sign_up" };
  if (!hasOrg) return { kind: "select_org" };

  // An organisation whose subscription cannot be read is on the default plan — the same answer
  // `planFromClaim` gives an empty session claim and `getOrgPlan` gives a billing outage.
  const current =
    typeof currentSlug === "string" && isPlanSlug(currentSlug) ? currentSlug : DEFAULT_PLAN;
  if (current === plan) return { kind: "current" };

  // The Free card is never a checkout: moving down from a paid plan is a cancellation, which Clerk
  // prorates and schedules inside its own subscription drawer.
  if (plan === DEFAULT_PLAN) return { kind: "manage" };

  if (!clerkPlanId) return { kind: "unavailable" };

  return {
    kind: "checkout",
    planId: clerkPlanId,
    period: period === "annual" && !hasAnnualPrice ? "month" : period,
  };
}

/** The shape of a `BillingMoneyAmount`, taken structurally so tests can hand in plain objects. */
export type MoneyLike = {
  amount: number;
  amountFormatted: string;
  currencySymbol: string;
};

/** The three prices a `BillingPlanResource` carries. Every one of them can be `null`. */
export type ClerkPlanPrices =
  | {
      fee?: MoneyLike | null;
      annualFee?: MoneyLike | null;
      annualMonthlyFee?: MoneyLike | null;
    }
  | null
  | undefined;

/** The list price from `PRICING`, in whole dollars per month. */
export type PriceFallback = { monthly: number; annual: number };

export type PlanPrice = {
  /** Ready to print, currency symbol included. */
  amount: string;
  /** Whether `amount` is a per-month figure, so the card knows to write "per month" after it. */
  perMonth: boolean;
  /** The small print under the price. */
  billedLine: string;
};

const FREE_LINE = "Free forever, no card";
const MONTHLY_LINE = "Billed monthly, cancel any time";
const YEARLY_LINE = "Billed yearly";

/**
 * `amountFormatted` is "29.00" for $29. The card sets the price in 4xl display type, where two
 * zero cents are noise — so they come off, and only when they are exactly that. A currency
 * formatted without decimals has nothing to strip.
 */
function money(value: MoneyLike): string {
  return `${value.currencySymbol}${value.amountFormatted.replace(/\.00$/, "")}`;
}

function dollars(value: number): string {
  return `$${value}`;
}

/**
 * What to print on the card: Clerk's price when the plan has loaded, the `PRICING` list price
 * otherwise, so the grid never renders a blank where a number belongs.
 *
 * Annual falls back to the monthly price for a plan Clerk has no annual price for — the same
 * fallback `planCta` makes, so the price on the card is the price the drawer will charge.
 */
export function priceFor(
  clerkPlan: ClerkPlanPrices,
  fallback: PriceFallback,
  period: PlanPeriod,
): PlanPrice {
  const annual = period === "annual";

  if (clerkPlan) {
    const monthly = clerkPlan.fee ?? null;
    const annualMonthly = clerkPlan.annualMonthlyFee ?? null;
    const annualTotal = clerkPlan.annualFee ?? null;

    if (annual && annualMonthly) {
      return {
        amount: money(annualMonthly),
        perMonth: true,
        billedLine: annualTotal ? `${YEARLY_LINE} at ${money(annualTotal)}` : YEARLY_LINE,
      };
    }

    // Priced as a yearly total with no monthly equivalent: show the total and say it is one.
    if (annual && annualTotal) {
      return { amount: money(annualTotal), perMonth: false, billedLine: YEARLY_LINE };
    }

    if (monthly) {
      return {
        amount: money(monthly),
        perMonth: true,
        billedLine: monthly.amount === 0 ? FREE_LINE : MONTHLY_LINE,
      };
    }

    // `fee: null` is a plan with no base fee — free to be on.
    return { amount: dollars(0), perMonth: true, billedLine: FREE_LINE };
  }

  const value = annual ? fallback.annual : fallback.monthly;
  return {
    amount: dollars(value),
    perMonth: true,
    billedLine:
      value === 0 ? FREE_LINE : annual ? `${YEARLY_LINE} at ${dollars(value * 12)}` : MONTHLY_LINE,
  };
}

/**
 * What the "save n%" badge on the yearly toggle claims, from Clerk when it has answered and from
 * the list prices otherwise. `null` when there is no annual price to save anything against, so the
 * badge disappears rather than claiming 0%.
 */
export function annualSavingPercent(
  clerkPlan: ClerkPlanPrices,
  fallback: PriceFallback,
): number | null {
  // Never mix the two sources: Clerk's amounts are minor units and the list prices are dollars, so
  // one of each would produce a number that is wrong by a factor of a hundred. A Clerk plan with no
  // annual price saves nothing, whatever the list table says.
  const [full, discounted] = clerkPlan
    ? [clerkPlan.fee?.amount ?? 0, clerkPlan.annualMonthlyFee?.amount ?? 0]
    : [fallback.monthly, fallback.annual];

  if (!full || !discounted || discounted >= full) return null;
  return Math.round((1 - discounted / full) * 100);
}

export type SubscriptionItemLike = {
  status?: string | null;
  planPeriod?: string | null;
  plan?: { slug?: string | null } | null;
};

export type SubscriptionLike =
  | { subscriptionItems?: readonly SubscriptionItemLike[] | null }
  | null
  | undefined;

export type CurrentPlan = {
  /** `null` while the subscription is unknown — which is not the same as being on Free. */
  slug: PlanSlug | null;
  period: PlanPeriod | null;
  /** True when the plan is only still in force because Clerk has not ended it yet. */
  pastDue: boolean;
};

/**
 * Which plan an organisation is on, read off its subscription.
 *
 * A subscription carries one item per plan, and Clerk keeps the default plan's item alongside a
 * paid one — so the answer is the *highest* plan in `PLAN_ORDER` with an active item, not the
 * first one found. A `past_due` item still counts: a late payment is Clerk's to resolve, and the
 * org keeps the plan until it says otherwise (the same rule `lib/billing.ts` applies server-side).
 */
export function currentPlan(subscription: SubscriptionLike): CurrentPlan {
  const items = subscription?.subscriptionItems ?? [];

  const best = (status: string): { slug: PlanSlug; item: SubscriptionItemLike } | null => {
    let found: { slug: PlanSlug; item: SubscriptionItemLike; rank: number } | null = null;

    for (const item of items) {
      if (item.status !== status) continue;
      const slug = item.plan?.slug;
      if (typeof slug !== "string" || !isPlanSlug(slug)) continue;

      const rank = PLAN_ORDER.indexOf(slug);
      if (!found || rank > found.rank) found = { slug, item, rank };
    }

    return found;
  };

  const active = best("active");
  const found = active ?? best("past_due");
  if (!found) return { slug: null, period: null, pastDue: false };

  return {
    slug: found.slug,
    period: found.item.planPeriod === "annual" ? "annual" : "month",
    pastDue: active === null,
  };
}
