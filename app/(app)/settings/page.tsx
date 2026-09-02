import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { CheckIcon, CreditCardIcon } from "lucide-react";

import { PlanUsage } from "@/components/billing/UsageBar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { featureLabel, featuresForPlan, PLAN_LABELS, planFromClaim, PLAN_LIMITS } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Workspace settings: which plan this organisation is on, what it has used, and the way to change
 * it. A server component, so the plan comes straight off the Clerk session token's `pla` claim —
 * the same source `convex/lib/auth.ts#requireOrg` and `app/(app)/w/[workflowId]/actions.ts` read
 * (CLAUDE.md rule 10: Clerk is the source of truth, nothing is mirrored).
 *
 * Nothing here is a gate. The plan drives what the page *says*; the refusals live in `has()` on the
 * server, in Convex mutations and in `runNode`.
 */
export default async function SettingsPage() {
  const { sessionClaims } = await auth();
  const plan = planFromClaim((sessionClaims as { pla?: unknown } | null)?.pla);
  const limits = PLAN_LIMITS[plan];
  const features = featuresForPlan(plan);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your organisation&rsquo;s plan and what it has used this month.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Plan
            <Badge variant="secondary">{PLAN_LABELS[plan]}</Badge>
          </CardTitle>
          <CardDescription>
            {plan === "free_org"
              ? `Up to ${limits.workflows} workflows and ${limits.runsPerMonth} runs a month, with schedules no faster than every ${limits.minScheduleMinutes} minutes.`
              : `${limits.runsPerMonth.toLocaleString("en-GB")} runs a month, unlimited workflows and schedules down to the minute.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckIcon aria-hidden className="size-3.5 shrink-0 text-emerald-500" />
                {featureLabel(feature)}
              </li>
            ))}
          </ul>

          <div>
            <Link href="/settings/billing" className={buttonVariants({ variant: "outline" })}>
              <CreditCardIcon />
              Manage plan
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>
            Counted per organisation. A run that is refused for being over the limit is never
            started, so it does not count against the next month either.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanUsage />
        </CardContent>
      </Card>
    </div>
  );
}
