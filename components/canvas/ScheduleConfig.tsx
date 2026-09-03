"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";

import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  describeMinutes,
  describeSchedule,
  nextFireTimes,
  timezoneFor,
  toCron,
  validateSchedule,
} from "@/lib/schedule";
import { parseScheduleInputs } from "@/nodes/triggers/schedule";

/**
 * The Schedule trigger's panel: what this schedule will actually do, and whether it is doing it.
 *
 * Read-only, on purpose. There used to be an Enable switch here, and it was the bug: publishing a
 * workflow whose trigger is a schedule did nothing at all, because starting the schedule was a
 * *second*, separate switch most people never found — the `schedules` table stayed empty while the
 * canvas said "Published". Publishing is now the one switch (`publishWorkflow` in
 * `app/(app)/w/[workflowId]/actions.ts` starts and cancels the scheduler run with the status), so
 * this panel's whole job is to report where that left things.
 *
 * The preview is the other half of the point. `mode: "every"` is translated to cron and cron is read
 * in a timezone, so "every 90 minutes" and "0 9 * * *" both mean something a little different from
 * what they look like — showing the next three real fire times is more honest than any amount of
 * explanation, and it is computed with the same `lib/schedule.ts` the scheduler step uses, so the
 * preview and the run cannot disagree.
 *
 * Everything shown comes through the live `schedules.getForWorkflow` subscription, so a workflow
 * published in another tab — or a `nextAt` moved by the scheduler firing thirty seconds ago — lands
 * here without a refresh.
 */

export type ScheduleConfigProps = {
  workflowId: Id<"workflows">;
  /** The trigger node's inputs, live from the canvas: the preview follows what you are typing. */
  inputs: Record<string, unknown>;
};

/** How often the preview re-bases itself on "now", so the next times do not go stale on screen. */
const TICK_MS = 30_000;

/**
 * The clock, as an external store.
 *
 * It has to be one rather than a piece of state set from an effect, for two reasons: the snapshot
 * is quantised to the tick so it is stable between changes (`getSnapshot` may not return a fresh
 * value every call), and `getServerSnapshot` answers `null` so the server renders "working it
 * out…" and React re-renders with a real time after hydration — the alternative is markup that
 * cannot possibly match.
 */
function subscribeToClock(onStoreChange: () => void): () => void {
  const timer = setInterval(onStoreChange, TICK_MS);
  return () => clearInterval(timer);
}

function clockTick(): number | null {
  return Math.floor(Date.now() / TICK_MS);
}

function noClockOnTheServer(): number | null {
  return null;
}

function formatFireTime(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

export function ScheduleConfig({ workflowId, inputs }: ScheduleConfigProps) {
  const status = useQuery(api.schedules.getForWorkflow, { workflowId });

  // `null` until mounted: fire times depend on the clock, and computing them while rendering on the
  // server would hand React different markup to hydrate.
  const tick = useSyncExternalStore(subscribeToClock, clockTick, noClockOnTheServer);
  const now = tick === null ? null : tick * TICK_MS;

  const spec = useMemo(() => parseScheduleInputs(inputs), [inputs]);
  const timezone = spec ? timezoneFor(spec) : "UTC";
  const cron = spec ? toCron(spec) : "";
  const upcoming = useMemo(
    () => (spec === null || now === null ? [] : nextFireTimes(spec, new Date(now), 3)),
    [now, spec],
  );

  // Decoration, not enforcement: the same check runs again in `enableSchedule`, which is what
  // actually decides (CLAUDE.md rule 3). Showing it here just means pressing Publish does not have
  // to be the way you find out your plan will not run this.
  const verdict = useMemo(
    () => (spec && status ? validateSchedule(spec, status.plan, new Date(now ?? 0)) : null),
    [now, spec, status],
  );

  const published = status?.status === "active";
  const running = published && (status?.schedule?.enabled ?? false);
  // The next fire time the *scheduler run* is actually sleeping on, which is not the same thing as
  // the preview: the preview follows the box you are typing in, this follows the saved schedule.
  const nextAt = status?.schedule?.nextAt;

  /**
   * Four states, and each one names its own way out:
   *
   * - running, with the instant the sleeping run will next wake;
   * - published but with no schedule row — the workflow was activated by something that only moves
   *   the status (an older client; the Builder's `finish` now publishes the same way this button
   *   does), so nothing is sleeping on it yet;
   * - not published, which is the ordinary "off";
   * - not configured yet, which the trigger's own fields above are where you fix.
   */
  const headline = spec === null ? "Not configured" : running ? "Running" : "Not running";
  const explanation =
    spec === null
      ? "Finish configuring the trigger above."
      : running
        ? now !== null && nextAt !== undefined
          ? `Runs ${describeSchedule(spec)} while this workflow is published — next run ${formatFireTime(new Date(nextAt), timezone)}.`
          : `Runs ${describeSchedule(spec)} while this workflow is published.`
        : published
          ? "This workflow is published, but no schedule is sleeping on it yet. Press Unpublish, then Publish, to start one."
          : "Not running: publish the workflow to start its schedule.";

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{headline}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{explanation}</p>
      </div>

      {cron.length > 0 && <p className="font-mono text-xs text-muted-foreground">{cron}</p>}

      {verdict && !verdict.ok ? (
        <p className="text-xs text-destructive">{verdict.error.message}</p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs font-medium">Next three runs</p>
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {now === null ? "Working it out…" : "This schedule has no upcoming runs."}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {upcoming.map((at) => (
                <li key={at.toISOString()} className="text-xs tabular-nums text-muted-foreground">
                  {formatFireTime(at, timezone)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">
          Your plan: at most once every {describeMinutes(status?.minScheduleMinutes ?? 60)}
        </Badge>
        {status?.schedule?.lastFiredAt !== undefined && (
          <Badge variant="secondary">
            Last fired {formatFireTime(new Date(status.schedule.lastFiredAt), timezone)}
          </Badge>
        )}
      </div>

      {status?.schedule?.lastError !== undefined && (
        // Convex is the alarm clock now: this is the one write the app never gets a chance to make,
        // because the tick that would have made it never reached the app at all (or the app refused
        // it outright). Amber rather than `text-destructive` — the schedule is not broken, it is one
        // missed or refused tick away from working again, and it keeps retrying on its own.
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Last tick could not reach the app: {status.schedule.lastError}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Publishing schedules the workflow that is <em>saved</em>: edit the interval above, let the
        canvas save, then unpublish and publish again.
      </p>
    </div>
  );
}
