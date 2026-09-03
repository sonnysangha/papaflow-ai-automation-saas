import {
  ActivityIcon,
  CircleCheckIcon,
  CircleXIcon,
  HistoryIcon,
  type LucideIcon,
  TimerIcon,
} from "lucide-react";

import { RUN_STATUS_TONE } from "@/components/shared/status";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formatSpanMs } from "./format";
import type { RunStats } from "./run-stats";

/**
 * The five numbers above the runs table: how many runs are in front of you, how many of them
 * worked, how many did not, how long a good one takes, and what is happening right now.
 *
 * Every figure is about the rows the page has loaded, which is why the first card names the window
 * rather than claiming a total. Colour is only ever used to say something — a failure count is red
 * because failures are red everywhere in this app, and stays muted at zero rather than shouting
 * green at you for having nothing wrong.
 */

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  /** The line under the number: what it is measured against. */
  hint: string;
  /** A status text colour from `RUN_STATUS_TONE`, when the number carries a state. */
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", tone ?? "text-foreground")}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hint}>
        {hint}
      </p>
    </div>
  );
}

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5";

/** The strip's shape while the first page is loading — five cards, not a spinner. */
export function RunStatsSkeleton() {
  return (
    <div className={GRID} role="status" aria-label="Loading run statistics">
      {[0, 1, 2, 3, 4].map((card) => (
        <div key={card} className="rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-14" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function RunStatsStrip({
  stats,
  windowDays,
}: {
  stats: RunStats;
  /** How far back the plan lets this page look, for the first card's hint. */
  windowDays?: number;
}) {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

  return (
    <div className={GRID}>
      <StatCard
        icon={HistoryIcon}
        label="Runs loaded"
        value={String(stats.total)}
        hint={windowDays === undefined ? "Newest first" : `Last ${windowDays} days, newest first`}
      />
      <StatCard
        icon={CircleCheckIcon}
        label="Success rate"
        value={stats.successRate === null ? "—" : `${stats.successRate}%`}
        hint={
          stats.finished === 0
            ? "Nothing has finished yet"
            : `${stats.completed} of ${plural(stats.finished, "finished run")}`
        }
        tone={stats.finished === 0 ? undefined : RUN_STATUS_TONE.completed.text}
      />
      <StatCard
        icon={CircleXIcon}
        label="Failed"
        value={String(stats.failed)}
        hint={stats.failed === 0 ? "None in this list" : "Open one to see which step"}
        tone={stats.failed === 0 ? undefined : RUN_STATUS_TONE.failed.text}
      />
      <StatCard
        icon={TimerIcon}
        label="Average run"
        value={stats.avgDurationMs === null ? "—" : formatSpanMs(stats.avgDurationMs)}
        hint={
          stats.completed === 0
            ? "No completed runs yet"
            : `Across ${plural(stats.completed, "completed run")}`
        }
      />
      <StatCard
        icon={ActivityIcon}
        label="Active now"
        value={String(stats.active)}
        hint={
          stats.oldestActiveMs === null
            ? "Nothing running"
            : `Oldest going for ${formatSpanMs(stats.oldestActiveMs)}`
        }
        tone={stats.active === 0 ? undefined : RUN_STATUS_TONE.running.text}
      />
    </div>
  );
}
