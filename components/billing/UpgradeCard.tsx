import Link from "next/link";
import { SparklesIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { featureLabel, PLAN_LABELS, planWithFeature } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * The wall a plan limit puts up, wherever one is hit: a Pro connector in the add-connection dialog,
 * the fourth workflow on the free plan, a run over the monthly quota, history the plan cannot see.
 *
 * Deliberately hookless, so the same component works as a `<Show>` fallback inside a client
 * component and as plain server-rendered markup on the settings page. It only ever *offers* the
 * upgrade — the actual refusals live in `has()` on the server and in Convex (CLAUDE.md rule 3).
 */

export type UpgradeCardProps = {
  /** The Clerk feature slug that is missing, when the wall is a feature rather than a count. */
  feature?: string;
  /** Overrides the generated heading ("Free plan: 3 workflows", say). */
  title?: string;
  /** Overrides the generated explanation. */
  description?: string;
  /** Squeezes the card into a strip, for the run bar and other tight spots. */
  compact?: boolean;
  className?: string;
};

export function UpgradeCard({
  feature,
  title,
  description,
  compact = false,
  className,
}: UpgradeCardProps) {
  const plan = feature ? planWithFeature(feature) : "pro";
  const planName = PLAN_LABELS[plan];
  const heading = title ?? (feature ? `${featureLabel(feature)} is a ${planName} feature` : `Upgrade to ${planName}`);
  const body =
    description ??
    (feature
      ? `Your organisation's plan does not include ${featureLabel(feature).toLowerCase()}. Upgrading unlocks it for everyone in the workspace.`
      : "Your organisation has reached the limit of its current plan.");

  const cta = (
    <Link
      href="/settings/billing"
      className={cn(buttonVariants({ size: compact ? "sm" : "default" }), "shrink-0")}
    >
      <SparklesIcon />
      Upgrade to {planName}
    </Link>
  );

  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2",
          className,
        )}
      >
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{heading}.</span>{" "}
          <span className="text-muted-foreground">{body}</span>
        </p>
        {cta}
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent>{cta}</CardContent>
    </Card>
  );
}
