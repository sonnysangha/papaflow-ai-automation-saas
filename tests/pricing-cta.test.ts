import { describe, expect, it } from "vitest";

import {
  annualSavingPercent,
  currentPlan,
  planCta,
  priceFor,
  type ClerkPlanPrices,
  type MoneyLike,
  type PlanCtaInput,
} from "@/components/billing/plan-cta";
import { PRICING } from "@/lib/plans";

/**
 * The decisions behind the plan cards. Everything here is what a browser check could not tell you
 * without three Clerk accounts on three different plans: what each card offers a signed-out
 * visitor, an org with no subscription, an org on Pro looking at Free, and an org that asked for
 * annual billing on a plan Clerk has no annual price for.
 */

const usd = (amount: number): MoneyLike => ({
  amount: amount * 100,
  amountFormatted: amount.toFixed(2),
  currencySymbol: "$",
});

/** The three plans as this Clerk instance actually has them: `team` has no annual price. */
const CLERK = {
  free_org: { fee: usd(0), annualFee: null, annualMonthlyFee: null },
  pro: { fee: usd(29), annualFee: usd(288), annualMonthlyFee: usd(24) },
  team: { fee: usd(99), annualFee: null, annualMonthlyFee: null },
} satisfies Record<string, ClerkPlanPrices>;

/** A signed-in org on Free, looking at Pro. Each test moves one thing. */
const base: PlanCtaInput = {
  plan: "pro",
  currentSlug: "free_org",
  signedIn: true,
  hasOrg: true,
  clerkPlanId: "cplan_pro",
  period: "month",
};

describe("planCta", () => {
  it("sends a signed-out visitor to sign up, whatever else is known", () => {
    expect(planCta({ ...base, signedIn: false })).toEqual({ kind: "sign_up" });
    expect(planCta({ ...base, signedIn: false, hasOrg: false, clerkPlanId: null })).toEqual({
      kind: "sign_up",
    });
  });

  it("sends a signed-in visitor with no active org to pick one", () => {
    // `CheckoutButton for="organization"` throws without one, so this branch has to come first.
    expect(planCta({ ...base, hasOrg: false })).toEqual({ kind: "select_org" });
  });

  it("marks the plan the org is already on", () => {
    expect(planCta({ ...base, currentSlug: "pro" })).toEqual({ kind: "current" });
    expect(planCta({ ...base, plan: "free_org" })).toEqual({ kind: "current" });
  });

  it("treats an unknown subscription as the free plan, the way the session claim does", () => {
    expect(planCta({ ...base, plan: "free_org", currentSlug: null })).toEqual({ kind: "current" });
    expect(planCta({ ...base, plan: "free_org", currentSlug: "enterprise" })).toEqual({
      kind: "current",
    });
    expect(planCta({ ...base, currentSlug: undefined })).toMatchObject({ kind: "checkout" });
  });

  it("hands the Free card to Clerk's subscription drawer while the org is on a paid plan", () => {
    expect(planCta({ ...base, plan: "free_org", currentSlug: "pro" })).toEqual({ kind: "manage" });
    expect(planCta({ ...base, plan: "free_org", currentSlug: "team" })).toEqual({ kind: "manage" });
  });

  it("checks out a paid plan the org is not on, in either direction", () => {
    expect(planCta(base)).toEqual({ kind: "checkout", planId: "cplan_pro", period: "month" });
    expect(
      planCta({ ...base, plan: "team", clerkPlanId: "cplan_team", currentSlug: "pro" }),
    ).toEqual({ kind: "checkout", planId: "cplan_team", period: "month" });
    // Downgrading between paid plans is still a checkout — Clerk prorates it.
    expect(planCta({ ...base, currentSlug: "team" })).toMatchObject({ kind: "checkout" });
  });

  it("passes the chosen period through when the plan has an annual price", () => {
    expect(planCta({ ...base, period: "annual" })).toEqual({
      kind: "checkout",
      planId: "cplan_pro",
      period: "annual",
    });
  });

  it("falls back to monthly rather than hiding the button when there is no annual price", () => {
    // `team` on this instance. The card still offers the plan; the drawer opens on the month price.
    expect(planCta({ ...base, period: "annual", hasAnnualPrice: false })).toEqual({
      kind: "checkout",
      planId: "cplan_pro",
      period: "month",
    });
  });

  it("is unavailable when Clerk has not returned an id for the slug", () => {
    expect(planCta({ ...base, clerkPlanId: undefined })).toEqual({ kind: "unavailable" });
    expect(planCta({ ...base, clerkPlanId: "" })).toEqual({ kind: "unavailable" });
    // …but only for a plan that would otherwise be a checkout.
    expect(planCta({ ...base, plan: "free_org", currentSlug: "pro", clerkPlanId: null })).toEqual({
      kind: "manage",
    });
  });
});

describe("priceFor", () => {
  it("prefers Clerk's price, trimming the zero cents off a whole amount", () => {
    expect(priceFor(CLERK.pro, PRICING.pro, "month")).toEqual({
      amount: "$29",
      perMonth: true,
      billedLine: "Billed monthly, cancel any time",
    });
  });

  it("shows the effective monthly price on annual, and the yearly total underneath", () => {
    expect(priceFor(CLERK.pro, PRICING.pro, "annual")).toEqual({
      amount: "$24",
      perMonth: true,
      billedLine: "Billed yearly at $288",
    });
  });

  it("bills a plan with no annual price monthly, matching planCta's fallback", () => {
    expect(priceFor(CLERK.team, PRICING.team, "annual")).toEqual({
      amount: "$99",
      perMonth: true,
      billedLine: "Billed monthly, cancel any time",
    });
  });

  it("shows a yearly total when that is the only price the plan has", () => {
    expect(
      priceFor({ fee: null, annualFee: usd(120), annualMonthlyFee: null }, PRICING.pro, "annual"),
    ).toEqual({ amount: "$120", perMonth: false, billedLine: "Billed yearly" });
  });

  it("says free for a zero fee and for a plan with no base fee at all", () => {
    expect(priceFor(CLERK.free_org, PRICING.free_org, "month")).toEqual({
      amount: "$0",
      perMonth: true,
      billedLine: "Free forever, no card",
    });
    expect(priceFor({ fee: null }, PRICING.free_org, "month")).toEqual({
      amount: "$0",
      perMonth: true,
      billedLine: "Free forever, no card",
    });
  });

  it("keeps a non-round amount and a non-dollar currency intact", () => {
    expect(
      priceFor(
        { fee: { amount: 2450, amountFormatted: "24.50", currencySymbol: "€" } },
        PRICING.pro,
        "month",
      ).amount,
    ).toBe("€24.50");
  });

  it("falls back to the list prices when Clerk has answered with nothing", () => {
    expect(priceFor(undefined, PRICING.pro, "month")).toEqual({
      amount: "$29",
      perMonth: true,
      billedLine: "Billed monthly, cancel any time",
    });
    expect(priceFor(null, PRICING.pro, "annual")).toEqual({
      amount: "$24",
      perMonth: true,
      billedLine: "Billed yearly at $288",
    });
    expect(priceFor(undefined, PRICING.free_org, "annual")).toEqual({
      amount: "$0",
      perMonth: true,
      billedLine: "Free forever, no card",
    });
  });
});

describe("annualSavingPercent", () => {
  it("is what Clerk's two prices actually differ by", () => {
    expect(annualSavingPercent(CLERK.pro, PRICING.pro)).toBe(17);
  });

  it("falls back to the list prices only when Clerk has answered with nothing", () => {
    expect(annualSavingPercent(undefined, PRICING.pro)).toBe(17);
    expect(annualSavingPercent(undefined, PRICING.free_org)).toBeNull();
    expect(annualSavingPercent(undefined, { monthly: 29, annual: 29 })).toBeNull();
  });

  it("claims nothing for a Clerk plan with no annual price, whatever the list table says", () => {
    // Mixing Clerk's minor units with the list table's dollars would read as a 99% saving.
    expect(annualSavingPercent(CLERK.team, PRICING.team)).toBeNull();
    expect(annualSavingPercent(CLERK.free_org, PRICING.free_org)).toBeNull();
  });
});

describe("currentPlan", () => {
  const item = (slug: string, status: string, planPeriod = "month") => ({
    status,
    planPeriod,
    plan: { slug },
  });

  it("does not guess when there is no subscription yet", () => {
    expect(currentPlan(undefined)).toEqual({ slug: null, period: null, pastDue: false });
    expect(currentPlan(null)).toEqual({ slug: null, period: null, pastDue: false });
    expect(currentPlan({ subscriptionItems: [] })).toEqual({
      slug: null,
      period: null,
      pastDue: false,
    });
  });

  it("takes the highest active plan, not the first item listed", () => {
    // Clerk keeps the default plan's item alongside the paid one.
    expect(
      currentPlan({ subscriptionItems: [item("free_org", "active"), item("pro", "active")] }),
    ).toEqual({ slug: "pro", period: "month", pastDue: false });
  });

  it("reads the billing period off the item that won", () => {
    expect(currentPlan({ subscriptionItems: [item("team", "active", "annual")] })).toEqual({
      slug: "team",
      period: "annual",
      pastDue: false,
    });
  });

  it("keeps a past-due plan, and says it is past due", () => {
    expect(currentPlan({ subscriptionItems: [item("pro", "past_due")] })).toEqual({
      slug: "pro",
      period: "month",
      pastDue: true,
    });
    // An active item outranks a past-due one, and clears the flag.
    expect(
      currentPlan({ subscriptionItems: [item("pro", "past_due"), item("free_org", "active")] }),
    ).toEqual({ slug: "free_org", period: "month", pastDue: false });
  });

  it("ignores ended items and plans this build has never heard of", () => {
    expect(currentPlan({ subscriptionItems: [item("pro", "ended")] })).toMatchObject({
      slug: null,
    });
    expect(currentPlan({ subscriptionItems: [item("enterprise", "active")] })).toMatchObject({
      slug: null,
    });
  });
});
