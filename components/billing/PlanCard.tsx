import { CheckIcon } from "lucide-react";

import { accentButton } from "@/components/marketing/primitives";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FEATURES,
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_ORDER,
  PRICING,
  featureLabel,
  type PlanSlug,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

import type { PlanPrice } from "./plan-cta";

/**
 * One plan, as a card. Everything Clerk-shaped — the checkout button, the plan-details link — is
 * handed in as a slot, which is what lets the layout be rendered (and checked) without a
 * `<ClerkProvider>`, a billing instance or a browser. `components/billing/PlanCards.tsx` fills the
 * slots in; `tests/pricing-card.test.tsx` fills them with a plain element.
 *
 * The two variants are the same card in two houses. `marketing` spends the teal accent from
 * `components/marketing/marketing.css`; `settings` cannot, because that stylesheet is only loaded
 * under `app/(marketing)/` and the product UI is deliberately neutral, so it emphasises with the
 * shadcn tokens instead. Same structure, same words, same order.
 */

export type PlanCardVariant = "marketing" | "settings";

type Skin = {
  /** The ring around the plan the page is nudging people towards. */
  highlight: string;
  badge: string;
  amount: string;
  check: string;
  chip: string;
};

const SKINS: Record<PlanCardVariant, Skin> = {
  marketing: {
    highlight: "border-[var(--pf-accent-line)] ring-3 ring-[var(--pf-accent-soft)]",
    badge: "bg-[var(--pf-accent-soft)] text-[var(--pf-accent)]",
    amount: "pf-display text-4xl font-semibold tracking-tight",
    check: "text-[var(--pf-accent)]",
    chip: "border-[var(--pf-accent-line)] text-[var(--pf-accent)]",
  },
  settings: {
    highlight: "border-primary/30 ring-3 ring-primary/10",
    badge: "bg-primary/10 text-primary",
    amount: "text-4xl font-semibold tracking-tight",
    check: "text-emerald-500",
    chip: "border-border text-muted-foreground",
  },
};

/**
 * The class a card's own call to action wears, so the plain `<button>` Clerk wraps looks like every
 * other button on the page. Emphasis follows the highlighted plan, not the CTA's kind: one accent
 * per grid.
 */
export function ctaClass(
  variant: PlanCardVariant,
  emphasised: boolean,
  className = "h-10 w-full",
): string {
  if (variant === "marketing") {
    return emphasised
      ? accentButton(className)
      : buttonVariants({ variant: "secondary", size: "lg", className });
  }

  return emphasised
    ? buttonVariants({ size: "lg", className })
    : buttonVariants({ variant: "outline", size: "lg", className });
}

/** Limits read as sentences, not as a number and a noun the reader has to assemble. */
export function limitLines(plan: PlanSlug): string[] {
  const limits = PLAN_LIMITS[plan];
  const count = (value: number, one: string, many: string) =>
    value === Infinity
      ? `Unlimited ${many}`
      : `${value.toLocaleString("en-GB")} ${value === 1 ? one : many}`;

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
export function addedFeatures(plan: PlanSlug): { inherits: string | null; added: string[] } {
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

export type PlanCardProps = {
  plan: PlanSlug;
  variant: PlanCardVariant;
  /** `null` renders a skeleton: Clerk has not answered with a price yet. */
  price: PlanPrice | null;
  /** From Clerk's `freeTrialDays`. Shown as a chip when the plan has one. */
  freeTrialDays?: number | null;
  /** The call to action. A `<Show>`-wrapped Clerk button, a `<Link>`, or a skeleton. */
  cta: React.ReactNode;
  /** The quiet line under the CTA — "See everything included" on the paid cards. */
  footnote?: React.ReactNode;
};

export function PlanCard({
  plan,
  variant,
  price,
  freeTrialDays,
  cta,
  footnote,
}: PlanCardProps) {
  const copy = PRICING[plan];
  const skin = SKINS[variant];
  const { inherits, added } = addedFeatures(plan);

  return (
    <li
      className={cn(
        "flex h-full flex-col gap-6 rounded-xl border border-border bg-card p-6",
        copy.highlighted && skin.highlight,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{PLAN_LABELS[plan]}</h2>
          {copy.highlighted ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-mono text-[0.65rem] tracking-wide uppercase",
                skin.badge,
              )}
            >
              Most picked
            </span>
          ) : null}
          {freeTrialDays ? (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[0.65rem] tracking-wide",
                skin.chip,
              )}
            >
              {freeTrialDays}-day free trial
            </span>
          ) : null}
        </div>
        {/* Two lines reserved so the price and the CTA sit on the same line in all three cards. */}
        <p className="min-h-8 font-mono text-xs text-muted-foreground">{copy.audience}</p>
      </div>

      <div className="flex min-h-16 flex-col gap-1">
        {price ? (
          <>
            <p className="flex flex-wrap items-baseline gap-1.5">
              <span className={skin.amount}>{price.amount}</span>
              {price.perMonth ? (
                <span className="text-sm text-muted-foreground">per month</span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">{price.billedLine}</p>
          </>
        ) : (
          <>
            <Skeleton className="h-10 w-28" />
            <Skeleton className="mt-1 h-3.5 w-40" />
          </>
        )}
      </div>

      <p className="min-h-10 text-sm text-pretty text-muted-foreground">{copy.tagline}</p>

      {/* Reserve the row: the CTA is `<Show>`-gated and renders nothing until Clerk has loaded. */}
      <div className="flex min-h-10 flex-col gap-2">
        {cta}
        {footnote}
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
              <CheckIcon className={cn("mt-0.5 size-4 shrink-0", skin.check)} aria-hidden />
              <span className="text-muted-foreground">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
