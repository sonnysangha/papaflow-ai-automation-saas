import type { Metadata } from "next";
import Link from "next/link";
import { PricingTable } from "@clerk/nextjs";
import { ArrowLeftIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Billing",
};

/**
 * Plans and checkout, rendered entirely by Clerk.
 *
 * `<PricingTable for="organization" />` lists the plans configured on the Clerk instance
 * (`free_org` / `pro` / `team`) and opens Clerk's own checkout drawer — in development that is
 * Clerk's shared test gateway, so no Stripe account is involved. `highlightedPlan` puts the
 * "Popular" badge on Pro and `newSubscriptionRedirectUrl` brings the org back here afterwards.
 *
 * Nothing on this page is a gate, and PapaFlow stores nothing about the subscription: the new plan
 * arrives on the *next* session token (`pla`/`fea`, ≤ 60 s), which is what Convex, `<Show>` and
 * `has()` all read. Until it refreshes, the walls elsewhere in the app still stand — which is the
 * honest behaviour, because the engine would refuse the run too.
 */
export default function BillingPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Plans</h1>
          <p className="text-sm text-muted-foreground">
            Plans apply to the whole organisation, and everyone in it gets the features. Changes
            take up to a minute to reach the app while your session token refreshes.
          </p>
        </div>
        <Link href="/settings" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ArrowLeftIcon />
          Back to settings
        </Link>
      </div>

      <PricingTable
        for="organization"
        highlightedPlan="pro"
        newSubscriptionRedirectUrl="/settings/billing"
        fallback={<Skeleton className="h-96 w-full rounded-xl" />}
      />
    </div>
  );
}
