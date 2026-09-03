"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Show, useAuth, useOrganization } from "@clerk/nextjs";
import {
  CheckoutButton,
  PlanDetailsButton,
  SubscriptionDetailsButton,
  usePlans,
  useSubscription,
} from "@clerk/nextjs/experimental";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PLAN_LABELS, PLAN_ORDER, PRICING, type PlanSlug } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { useClerkAppearance } from "./clerk-appearance";
import { PlanCard, ctaClass, type PlanCardVariant } from "./PlanCard";
import {
  annualSavingPercent,
  currentPlan,
  planCta,
  priceFor,
  type PlanPeriod,
} from "./plan-cta";

/**
 * The plan grid, on the public pricing page and in Settings → Plans. One component, because the
 * two pages were drifting: the marketing cards said "Manage plan" and linked to Clerk's stock
 * `<PricingTable>`, which meant the only place anyone could actually buy anything looked nothing
 * like the page that sold it.
 *
 * Now the cards are ours everywhere and Clerk owns exactly one thing: the drawer. `CheckoutButton`,
 * `SubscriptionDetailsButton` and `PlanDetailsButton` each wrap a plain `<button>` of ours — Clerk
 * clones the child and attaches its own click handler, so the markup and the classes stay here.
 *
 * Prices come from Clerk (`usePlans`) so a price change on the instance reaches both pages without
 * a deploy, and fall back to the list prices in `lib/plans.ts` while that loads or if it fails.
 * Plan ids are instance-specific `cplan_…` strings and are never hardcoded: they are resolved by
 * matching Clerk's `slug` against `PLAN_ORDER`.
 *
 * Nothing here gates anything (CLAUDE.md rule 3), and `useSubscription` is read for display only —
 * what the app actually enforces is the `pla`/`fea` claims on the next session token.
 */

export type PlanCardsProps = {
  variant: PlanCardVariant;
  /** Where Clerk sends the org after a completed checkout. */
  redirectUrl: string;
};

/** The second, quieter action on a card: a Clerk drawer that is not the point of the card. */
const quietLink =
  "self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/** Where a signed-out visitor lands back after signing up from a card. */
const SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent("/pricing")}`;

export function PlanCards({ variant, redirectUrl }: PlanCardsProps) {
  const [period, setPeriod] = useState<PlanPeriod>("month");
  const toggleId = useId();
  const appearance = useClerkAppearance();

  const { isSignedIn } = useAuth();
  const { organization } = useOrganization();
  const plans = usePlans({ for: "organization" });
  const subscription = useSubscription({ for: "organization" });

  // One lookup per render instead of a scan per card, and the only place a slug becomes a Clerk id.
  const bySlug = useMemo(
    () => new Map(plans.data.map((plan) => [plan.slug, plan] as const)),
    [plans.data],
  );

  // A billing outage must not blank the pricing page: the cards quietly fall back to the list
  // prices, and the reason is logged once rather than on every re-render.
  const logged = useRef(false);
  useEffect(() => {
    if (!plans.error || logged.current) return;
    logged.current = true;
    console.warn(
      "billing: Clerk did not return plans; showing the list prices from lib/plans.ts",
      plans.error.message,
    );
  }, [plans.error]);

  const signedIn = isSignedIn === true;
  const hasOrg = Boolean(organization?.id);
  const current = currentPlan(subscription.data);
  const annual = period === "annual";
  const saving = annualSavingPercent(bySlug.get("pro"), PRICING.pro);

  /** The CTA cannot be decided until Clerk has said what exists and what the org is on. */
  const ctaLoading = plans.isLoading || (signedIn && hasOrg && subscription.isLoading);

  const onSubscriptionComplete = () => {
    void subscription.revalidate();
    void plans.revalidate();
    toast.success("Plan updated", {
      description: "It reaches the rest of the app when your session token refreshes.",
    });
  };

  const ctaFor = (plan: PlanSlug, emphasised: boolean) => {
    const clerkPlan = bySlug.get(plan);
    const cta = planCta({
      plan,
      currentSlug: current.slug,
      signedIn,
      hasOrg,
      clerkPlanId: clerkPlan?.id,
      period,
      hasAnnualPrice: Boolean(clerkPlan?.annualMonthlyFee ?? clerkPlan?.annualFee),
    });

    const label =
      plan === "free_org" ? "Start free" : `Start with ${PLAN_LABELS[plan]}`;
    const upgradeLabel =
      plan === "team" ? "Move to Team" : `Upgrade to ${PLAN_LABELS[plan]}`;
    const className = ctaClass(variant, emphasised);

    // Neither of these needs Clerk's billing data, so they render straight away.
    if (cta.kind === "sign_up") {
      return (
        <Link href={SIGN_UP_HREF} className={className}>
          {label}
        </Link>
      );
    }

    if (cta.kind === "select_org") {
      return (
        <Link href="/select-org" className={className}>
          Choose an organisation
        </Link>
      );
    }

    if (ctaLoading) return <Skeleton className="h-10 w-full" />;

    // Every Clerk billing button throws when it renders signed out, and `for="organization"`
    // throws again without an active org — `<Show>` is the second lock on the first of those.
    if (cta.kind === "current") {
      return (
        <Show when="signed-in" fallback={<Skeleton className="h-10 w-full" />}>
          <button type="button" className={ctaClass(variant, false)} disabled>
            Current plan
          </button>
          {plan === "free_org" ? null : (
            <SubscriptionDetailsButton
              for="organization"
              subscriptionDetailsProps={{ appearance }}
              onSubscriptionCancel={() => void subscription.revalidate()}
            >
              <button type="button" className={quietLink}>
                Manage subscription
              </button>
            </SubscriptionDetailsButton>
          )}
        </Show>
      );
    }

    if (cta.kind === "manage") {
      return (
        <Show when="signed-in" fallback={<Skeleton className="h-10 w-full" />}>
          <SubscriptionDetailsButton
            for="organization"
            subscriptionDetailsProps={{ appearance }}
            onSubscriptionCancel={() => void subscription.revalidate()}
          >
            <button type="button" className={className}>
              Switch to Free
            </button>
          </SubscriptionDetailsButton>
        </Show>
      );
    }

    if (cta.kind === "checkout") {
      return (
        <Show when="signed-in" fallback={<Skeleton className="h-10 w-full" />}>
          <CheckoutButton
            planId={cta.planId}
            planPeriod={cta.period}
            for="organization"
            newSubscriptionRedirectUrl={redirectUrl}
            onSubscriptionComplete={onSubscriptionComplete}
            checkoutProps={{ appearance }}
          >
            <button type="button" className={className}>
              {upgradeLabel}
            </button>
          </CheckoutButton>
        </Show>
      );
    }

    // Clerk knows of no plan with this slug — the app's own plan table is ahead of the instance.
    return (
      <button
        type="button"
        className={className}
        disabled
        title="This plan is not available on this billing instance yet"
      >
        {upgradeLabel}
      </button>
    );
  };

  const footnoteFor = (plan: PlanSlug) => {
    const clerkPlan = bySlug.get(plan);
    if (plan === "free_org" || !clerkPlan) return null;

    return (
      <Show when="signed-in">
        <PlanDetailsButton
          planId={clerkPlan.id}
          initialPlanPeriod={period}
          planDetailsProps={{ appearance }}
        >
          <button type="button" className={quietLink}>
            See everything included
          </button>
        </PlanDetailsButton>
      </Show>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        {/* The switch itself stays 32×18 — its own design — inside a 44px reach, so a thumb has
            something to hit without the control looking oversized. */}
        <Switch
          id={toggleId}
          checked={annual}
          onCheckedChange={(checked) => setPeriod(checked ? "annual" : "month")}
          aria-describedby={saving === null ? undefined : `${toggleId}-saving`}
          className="relative after:absolute after:-inset-3 after:content-[''] sm:after:hidden"
        />
        <label
          htmlFor={toggleId}
          className="flex min-h-11 items-center text-sm font-medium select-none sm:min-h-0"
        >
          Bill yearly
        </label>
        {saving === null ? null : (
          <span
            id={`${toggleId}-saving`}
            className={cn(
              "font-mono text-xs",
              variant === "marketing" ? "text-[var(--pf-accent)]" : "text-muted-foreground",
            )}
          >
            save {saving}%
          </span>
        )}
      </div>

      <ul className="grid gap-5 lg:grid-cols-3">
        {PLAN_ORDER.map((plan) => {
          const clerkPlan = bySlug.get(plan);
          const emphasised = PRICING[plan].highlighted;

          return (
            <PlanCard
              key={plan}
              plan={plan}
              variant={variant}
              // A skeleton only while Clerk might still answer; after that the list price stands.
              price={
                plans.isLoading ? null : priceFor(clerkPlan, PRICING[plan], period)
              }
              freeTrialDays={clerkPlan?.freeTrialDays}
              cta={ctaFor(plan, emphasised)}
              footnote={footnoteFor(plan)}
            />
          );
        })}
      </ul>
    </div>
  );
}
