"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { CheckIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { accentButton } from "./primitives";
import {
  FEATURES,
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_ORDER,
  PRICING,
  featureLabel,
  type PlanSlug,
} from "@/lib/plans";

/**
 * The three plans, generated from `lib/plans.ts` — the same table Convex, `has()` and `runNode`
 * enforce. Nothing on this page is a gate and nothing here charges anyone: the CTA hands a
 * signed-in visitor to Clerk's own `<PricingTable>` at `/settings/billing`, which owns checkout.
 */

/** Limits read as sentences, not as a number and a noun the reader has to assemble. */
function limitLines(plan: PlanSlug): string[] {
  const limits = PLAN_LIMITS[plan];
  const count = (value: number, one: string, many: string) =>
    value === Infinity ? `Unlimited ${many}` : `${value.toLocaleString("en-GB")} ${value === 1 ? one : many}`;

  return [
    count(limits.workflows, "workflow", "workflows"),
    `${limits.runsPerMonth.toLocaleString("en-GB")} runs a month`,
    count(limits.members, "member", "members"),
    // Every plan can schedule; the `schedules` feature only lifts the interval floor
    // (`app/api/schedules/route.ts` checks `PLAN_LIMITS.minScheduleMinutes` without it), so the
    // line is derived from that number rather than from whether the feature is present.
    limits.minScheduleMinutes <= 1
      ? "Schedules down to every minute"
      : limits.minScheduleMinutes % 60 === 0
        ? `Schedules every ${limits.minScheduleMinutes / 60 === 1 ? "hour" : `${limits.minScheduleMinutes / 60} hours`} or slower`
        : `Schedules every ${limits.minScheduleMinutes} minutes or slower`,
  ];
}

/** What this plan adds over the one below it, so the cards read as a ladder and not three lists. */
function addedFeatures(plan: PlanSlug): { inherits: string | null; added: string[] } {
  const index = PLAN_ORDER.indexOf(plan);
  const previous = index > 0 ? PLAN_ORDER[index - 1] : null;
  const inherited = previous ? (FEATURES[previous] as readonly string[]) : [];

  return {
    inherits: previous ? PLAN_LABELS[previous] : null,
    added: (FEATURES[plan] as readonly string[])
      .filter((slug) => !inherited.includes(slug))
      .map(featureLabel),
  };
}

function price(plan: PlanSlug, annual: boolean): number {
  const row = PRICING[plan];
  return annual ? row.annual : row.monthly;
}

const SAVING = Math.round((1 - PRICING.pro.annual / PRICING.pro.monthly) * 100);

export function PlanCards() {
  const [annual, setAnnual] = useState(false);
  const toggleId = useId();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Switch
          id={toggleId}
          checked={annual}
          onCheckedChange={setAnnual}
          aria-describedby={`${toggleId}-saving`}
        />
        <label htmlFor={toggleId} className="text-sm font-medium select-none">
          Bill yearly
        </label>
        <span
          id={`${toggleId}-saving`}
          className="font-mono text-xs text-[var(--pf-accent)]"
        >
          save {SAVING}%
        </span>
      </div>

      <ul className="grid gap-5 lg:grid-cols-3">
        {PLAN_ORDER.map((plan) => {
          const copy = PRICING[plan];
          const { inherits, added } = addedFeatures(plan);
          const amount = price(plan, annual);

          return (
            <li
              key={plan}
              className={cn(
                "flex h-full flex-col gap-6 rounded-xl border border-border bg-card p-6",
                copy.highlighted &&
                  "border-[var(--pf-accent-line)] ring-3 ring-[var(--pf-accent-soft)]",
              )}
            >
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {PLAN_LABELS[plan]}
                  </h2>
                  {copy.highlighted ? (
                    <span className="rounded-full bg-[var(--pf-accent-soft)] px-2 py-0.5 font-mono text-[0.65rem] tracking-wide text-[var(--pf-accent)] uppercase">
                      Most picked
                    </span>
                  ) : null}
                </div>
                {/* Two lines reserved so the price and the CTA sit on the same line in all three cards. */}
                <p className="min-h-8 font-mono text-xs text-muted-foreground">
                  {copy.audience}
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <p className="flex items-baseline gap-1.5">
                  <span className="pf-display text-4xl font-semibold tracking-tight">
                    ${amount}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    per month
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {amount === 0
                    ? "Free forever, no card"
                    : annual
                      ? `Billed yearly at $${amount * 12}`
                      : "Billed monthly, cancel any time"}
                </p>
              </div>

              <p className="min-h-10 text-sm text-pretty text-muted-foreground">
                {copy.tagline}
              </p>

              {/* Reserve the row: `<Show>` renders nothing until Clerk has loaded. */}
              <div className="min-h-10">
                <Show
                when="signed-in"
                fallback={
                  <Link
                    href="/sign-up"
                    className={
                      copy.highlighted
                        ? accentButton("h-10 w-full")
                        : buttonVariants({
                            variant: "secondary",
                            size: "lg",
                            className: "h-10 w-full",
                          })
                    }
                  >
                    {plan === "free_org" ? "Start free" : `Start with ${PLAN_LABELS[plan]}`}
                  </Link>
                }
              >
                <Link
                  href="/settings/billing"
                  className={
                    copy.highlighted
                      ? accentButton("h-10 w-full")
                      : buttonVariants({
                          variant: "secondary",
                          size: "lg",
                          className: "h-10 w-full",
                        })
                  }
                >
                  Manage plan
                </Link>
              </Show>
              </div>

              <ul className="flex flex-col gap-2 border-t border-border pt-5 font-mono text-xs text-muted-foreground">
                {limitLines(plan).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-foreground">
                  {inherits ? `Everything in ${inherits}, plus` : "Included"}
                </p>
                <ul className="flex flex-col gap-2">
                  {added.map((label) => (
                    <li key={label} className="flex items-start gap-2 text-sm">
                      <CheckIcon
                        className="mt-0.5 size-4 shrink-0 text-[var(--pf-accent)]"
                        aria-hidden
                      />
                      <span className="text-muted-foreground">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
