"use client";

import { useQuery } from "convex/react";

import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

/**
 * How much of the plan's allowance the organisation has used, live from Convex.
 *
 * There is no shadcn `Progress` in this workspace, so the bar is a div — one fewer dependency for
 * two numbers. The numbers themselves are the ones the limits are actually enforced against
 * (`convex/usage.ts#current` reads the same rows `incrementRuns` and `workflows.create` do), so a
 * full bar is exactly the wall the next action hits rather than an estimate of it.
 */

export type UsageBarProps = {
  label: string;
  value: number;
  /** `null` means unlimited: the bar renders empty with an "Unlimited" note instead of a ratio. */
  limit: number | null;
  hint?: string;
};

/** Amber from four-fifths, destructive once the allowance is gone. */
function toneFor(ratio: number): string {
  if (ratio >= 1) return "bg-destructive";
  if (ratio >= 0.8) return "bg-amber-500";
  return "bg-foreground/70";
}

export function UsageBar({ label, value, limit, hint }: UsageBarProps) {
  const unlimited = limit === null;
  const ratio = unlimited || limit === 0 ? 0 : Math.min(value / limit, 1);
  const percent = Math.round(ratio * 100);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {unlimited ? `${value} · Unlimited` : `${value} of ${limit}`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={unlimited ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={unlimited ? undefined : limit}
        aria-valuetext={unlimited ? `${value}, unlimited` : `${value} of ${limit}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", toneFor(ratio))}
          style={{ width: `${percent}%` }}
        />
      </div>

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The settings page's usage block: runs this month and workflows, both against the plan on the
 * caller's session token. A client component because it subscribes — a run started in another tab
 * moves the bar without a reload.
 */
export function PlanUsage() {
  const usage = useQuery(api.usage.current, {});

  if (usage === undefined) {
    return (
      <div className="grid gap-4" role="status" aria-label="Loading usage">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <UsageBar
        label="Runs this month"
        value={usage.runs}
        limit={usage.limits.runsPerMonth}
        hint={`Counted for ${usage.month}; the allowance resets at the start of each UTC month.`}
      />
      <UsageBar label="Workflows" value={usage.workflows} limit={usage.limits.workflows} />
    </div>
  );
}
