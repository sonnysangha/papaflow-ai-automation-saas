"use client";

import { Show, useOrganization } from "@clerk/nextjs";
import { SubscriptionDetailsButton, useSubscription } from "@clerk/nextjs/experimental";
import { AlertTriangleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_PLAN, PLAN_LABELS } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { useClerkAppearance } from "./clerk-appearance";
import { currentPlan } from "./plan-cta";

/**
 * What this organisation is on right now, above the grid of what it could be on.
 *
 * Read from Clerk's `useSubscription` rather than from the session token, because this is the one
 * place where being a minute behind would be confusing: someone who has just paid is looking at
 * this card. It is display only — every refusal in the app still reads the `pla`/`fea` claims,
 * which is exactly what the note at the bottom says.
 *
 * Cancelling, resuming and switching period all live in Clerk's subscription drawer; the button
 * below is ours, the drawer is theirs.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatDate(value: Date | string | number): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}

export function CurrentPlanCard() {
  const { organization } = useOrganization();
  const subscription = useSubscription({ for: "organization" });
  const appearance = useClerkAppearance();

  const current = currentPlan(subscription.data);
  const plan = current.slug ?? DEFAULT_PLAN;
  const nextPayment = subscription.data?.nextPayment ?? null;
  const nextPaymentDate = nextPayment ? formatDate(nextPayment.date) : null;
  const pastDueSince = subscription.data?.pastDueAt ? formatDate(subscription.data.pastDueAt) : null;
  const pastDue = current.pastDue || subscription.data?.status === "past_due";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Current plan
          {subscription.isLoading ? (
            <Skeleton className="h-5 w-14" />
          ) : (
            <Badge variant="secondary">{PLAN_LABELS[plan]}</Badge>
          )}
          {current.period === "annual" ? (
            <span className="font-mono text-xs font-normal text-muted-foreground">
              billed yearly
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          {subscription.isLoading ? (
            <Skeleton className="h-4 w-64" />
          ) : nextPayment && nextPaymentDate ? (
            `Next payment ${nextPayment.amount.currencySymbol}${nextPayment.amount.amountFormatted} on ${nextPaymentDate}.`
          ) : plan === DEFAULT_PLAN ? (
            "The free plan. Nothing to pay, and no card on file."
          ) : (
            "No upcoming payment is scheduled."
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {pastDue ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              This subscription is past due
              {pastDueSince ? ` since ${pastDueSince}` : ""}. The plan keeps working until Clerk
              ends it — update the payment method to keep it.
            </span>
          </p>
        ) : null}

        {/* `for="organization"` throws without an active org, so the button waits for both. */}
        {organization ? (
          <Show when="signed-in" fallback={<Skeleton className="h-8 w-44" />}>
            {/* Stacked and full width on a phone, side by side from `sm` up — so a second action
                added here lands under this one rather than squeezing it. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SubscriptionDetailsButton
                for="organization"
                subscriptionDetailsProps={{ appearance }}
                onSubscriptionCancel={() => void subscription.revalidate()}
              >
                <button
                  type="button"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-10 w-full sm:h-8 sm:w-auto",
                  )}
                >
                  Manage subscription
                </button>
              </SubscriptionDetailsButton>
            </div>
          </Show>
        ) : null}

        <p className="text-xs text-muted-foreground">
          A change here reaches the rest of the app on your next session token, usually within a
          minute. Until then the old plan&rsquo;s limits still apply, because the engine reads the
          same claim.
        </p>
      </CardContent>
    </Card>
  );
}
