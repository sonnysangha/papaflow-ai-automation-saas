import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlanCard, addedFeatures, ctaClass, limitLines } from "@/components/billing/PlanCard";
import { PLAN_LABELS, PLAN_LIMITS } from "@/lib/plans";

/**
 * The card, in the half that can be checked without a browser: what it claims about a plan.
 *
 * `CheckoutButton` and friends cannot render without a `<ClerkProvider>` and a live billing
 * instance, which is exactly why the call to action is a slot on `PlanCard` rather than something
 * it builds. `components/billing/PlanCards.tsx` fills the slot with the Clerk button; here it is a
 * plain element, and what is under test is the claim around it — the price, the limits, and the
 * "everything in X, plus" ladder that has to agree with the table the app enforces.
 */

const price = { amount: "$29", perMonth: true, billedLine: "Billed monthly, cancel any time" };

const render = (markup: React.ReactElement) => renderToStaticMarkup(markup);

const proCard = (extra?: Partial<React.ComponentProps<typeof PlanCard>>) =>
  render(
    <PlanCard
      plan="pro"
      variant="marketing"
      price={price}
      cta={<a href="/checkout">Upgrade to Pro</a>}
      {...extra}
    />,
  );

describe("PlanCard", () => {
  it("names the plan, its price and the call to action it was handed", () => {
    const html = proCard();

    expect(html).toContain(PLAN_LABELS.pro);
    expect(html).toContain("$29");
    expect(html).toContain("per month");
    expect(html).toContain("Billed monthly, cancel any time");
    expect(html).toContain('href="/checkout"');
    expect(html).toContain("Upgrade to Pro");
  });

  it("badges the plan the page is nudging people towards", () => {
    expect(proCard()).toContain("Most picked");
    expect(
      render(<PlanCard plan="team" variant="marketing" price={price} cta={null} />),
    ).not.toContain("Most picked");
  });

  it("shows a skeleton instead of a price while Clerk has not answered", () => {
    const html = proCard({ price: null });

    expect(html).toContain("skeleton");
    expect(html).not.toContain("$29");
    expect(html).not.toContain("per month");
  });

  it("drops the 'per month' when the amount is a whole billing period", () => {
    const html = proCard({ price: { amount: "$288", perMonth: false, billedLine: "Billed yearly" } });

    expect(html).toContain("$288");
    expect(html).not.toContain("per month");
  });

  it("chips a free trial only when Clerk says there is one", () => {
    expect(proCard({ freeTrialDays: 14 })).toContain("14-day free trial");
    expect(proCard({ freeTrialDays: null })).not.toContain("free trial");
    expect(proCard()).not.toContain("free trial");
  });

  it("renders the footnote slot under the call to action", () => {
    expect(proCard({ footnote: <span>See everything included</span> })).toContain(
      "See everything included",
    );
    expect(proCard()).not.toContain("See everything included");
  });

  it("spends the marketing accent only on the marketing variant", () => {
    expect(proCard()).toContain("--pf-accent");
    expect(
      render(<PlanCard plan="pro" variant="settings" price={price} cta={null} />),
    ).not.toContain("--pf-accent");
  });

  it("states the limits the app actually enforces", () => {
    const html = proCard();

    expect(html).toContain("Unlimited workflows");
    expect(html).toContain(`${PLAN_LIMITS.pro.runsPerMonth.toLocaleString("en-GB")} runs a month`);
    expect(html).toContain("5 members");
    expect(html).toContain("Schedules down to every minute");
  });

  it("reads as a ladder: what this plan adds over the one below it", () => {
    const html = proCard();

    expect(html).toContain("Everything in Free, plus");
    expect(html).toContain("AI builder");
    // Inherited from Free, so it is not repeated here.
    expect(html).not.toContain("Core connectors");
  });
});

describe("limitLines", () => {
  it("counts in sentences, and says unlimited rather than Infinity", () => {
    expect(limitLines("free_org")).toEqual([
      "3 workflows",
      "100 runs a month",
      "1 member",
      "Schedules every hour or slower",
    ]);
    expect(limitLines("team")).toEqual([
      "Unlimited workflows",
      "50,000 runs a month",
      "Unlimited members",
      "Schedules down to every minute",
    ]);
  });
});

describe("addedFeatures", () => {
  it("starts the ladder at Free and never repeats an inherited feature", () => {
    expect(addedFeatures("free_org")).toEqual({
      inherits: null,
      added: ["Core connectors"],
    });
    expect(addedFeatures("team")).toEqual({
      inherits: "Pro",
      added: ["Shared connections", "Audit log", "Priority runs"],
    });
  });
});

describe("ctaClass", () => {
  it("gives the highlighted plan the accent, and only in marketing", () => {
    expect(ctaClass("marketing", true)).toContain("--pf-accent-surface");
    expect(ctaClass("marketing", false)).not.toContain("--pf-accent-surface");
    expect(ctaClass("settings", true)).not.toContain("--pf-accent");
    expect(ctaClass("settings", false)).not.toContain("--pf-accent");
  });

  it("fills the card's width unless told otherwise", () => {
    expect(ctaClass("settings", true)).toContain("w-full");
    expect(ctaClass("settings", true, "h-8")).not.toContain("w-full");
  });
});
