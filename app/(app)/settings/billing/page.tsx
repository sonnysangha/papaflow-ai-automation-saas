import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { CurrentPlanCard } from "@/components/billing/CurrentPlanCard";
import { PlanCards } from "@/components/billing/PlanCards";
import { UpgradedNotice } from "@/components/billing/UpgradedNotice";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Billing",
};

/**
 * Plans and checkout, in the app's own cards.
 *
 * Clerk's stock `<PricingTable>` used to render this whole page. It works, but it is a second
 * design in the middle of the product, and the public pricing page had already grown its own cards
 * — so both now render `components/billing/PlanCards`, and Clerk owns only the checkout drawer
 * behind `CheckoutButton` (in development that is Clerk's shared test gateway, so no Stripe
 * account is involved).
 *
 * Nothing on this page is a gate, and PapaFlow stores nothing about the subscription: the new plan
 * arrives on the *next* session token (`pla`/`fea`, ≤ 60 s), which is what Convex, `<Show>` and
 * `has()` all read. Until it refreshes, the walls elsewhere in the app still stand — which is the
 * honest behaviour, because the engine would refuse the run too. `CurrentPlanCard` says so.
 */
export default function BillingPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      {/* On a phone "Back to settings" reads as an up-link above the title rather than a button
          stranded under two lines of prose; from `sm` up it goes back to the right of the row. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Link
          href="/settings"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "self-start sm:order-2",
          )}
        >
          <ArrowLeftIcon />
          Back to settings
        </Link>
        <div className="flex flex-col gap-1 sm:order-1">
          <h1 className="text-xl font-semibold tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground">
            Plans apply to the whole organisation, and everyone in it gets the features.
          </p>
        </div>
      </div>

      {/* `?upgraded=1` comes back from a checkout that started on the public pricing page. */}
      <Suspense fallback={null}>
        <UpgradedNotice />
      </Suspense>

      <CurrentPlanCard />

      <PlanCards variant="settings" redirectUrl="/settings/billing" />
    </div>
  );
}
