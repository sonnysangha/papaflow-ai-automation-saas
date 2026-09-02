import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearOrgPlanCache, getOrgPlan } from "@/lib/billing";

/**
 * `getOrgPlan` is the engine's answer to "what plan is this org on?" when there is no session to
 * read `pla` from — so the Clerk Backend API is the only input, and these tests own it.
 *
 * `vi.hoisted` because `vi.mock` factories run while the module under test is being imported,
 * before any plain `const` in this file has been initialised.
 */
const { getOrganizationBillingSubscription } = vi.hoisted(() => ({
  getOrganizationBillingSubscription: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({ billing: { getOrganizationBillingSubscription } })),
}));

/** One `subscriptionItems` entry, as `BillingSubscription` carries it. */
function item(status: string, slug: string | null) {
  return { status, plan: slug === null ? null : { slug } };
}

beforeEach(() => {
  clearOrgPlanCache();
  getOrganizationBillingSubscription.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getOrgPlan", () => {
  it("reads the slug of the active subscription item", async () => {
    getOrganizationBillingSubscription.mockResolvedValue({
      subscriptionItems: [item("canceled", "team"), item("active", "pro")],
    });

    expect(await getOrgPlan("org_1")).toBe("pro");
    expect(getOrganizationBillingSubscription).toHaveBeenCalledWith("org_1");
  });

  it("keeps a past_due org on its plan when nothing is active", async () => {
    getOrganizationBillingSubscription.mockResolvedValue({
      subscriptionItems: [item("past_due", "team")],
    });

    expect(await getOrgPlan("org_1")).toBe("team");
  });

  it("falls back to the free plan for no items, an unknown slug or no plan at all", async () => {
    getOrganizationBillingSubscription.mockResolvedValue({ subscriptionItems: [] });
    expect(await getOrgPlan("org_none")).toBe("free_org");

    getOrganizationBillingSubscription.mockResolvedValue({
      subscriptionItems: [item("active", "enterprise_2027")],
    });
    expect(await getOrgPlan("org_unknown")).toBe("free_org");

    getOrganizationBillingSubscription.mockResolvedValue({
      subscriptionItems: [item("active", null)],
    });
    expect(await getOrgPlan("org_planless")).toBe("free_org");
  });

  it("answers free_org and logs when the Clerk API fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    getOrganizationBillingSubscription.mockRejectedValue(new Error("clerk is down"));

    expect(await getOrgPlan("org_1")).toBe("free_org");
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("caches per org for 60 seconds, then asks again", async () => {
    vi.useFakeTimers();
    getOrganizationBillingSubscription.mockResolvedValue({
      subscriptionItems: [item("active", "pro")],
    });

    expect(await getOrgPlan("org_1")).toBe("pro");
    expect(await getOrgPlan("org_1")).toBe("pro");
    expect(getOrganizationBillingSubscription).toHaveBeenCalledTimes(1);

    // A second org is a second entry, not a cache hit.
    expect(await getOrgPlan("org_2")).toBe("pro");
    expect(getOrganizationBillingSubscription).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60_001);
    expect(await getOrgPlan("org_1")).toBe("pro");
    expect(getOrganizationBillingSubscription).toHaveBeenCalledTimes(3);
  });

  it("caches the fallback too, so an outage costs one call a minute", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getOrganizationBillingSubscription.mockRejectedValue(new Error("clerk is down"));

    expect(await getOrgPlan("org_1")).toBe("free_org");
    expect(await getOrgPlan("org_1")).toBe("free_org");
    expect(getOrganizationBillingSubscription).toHaveBeenCalledTimes(1);
  });
});
