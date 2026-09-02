"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
 * The Schedule trigger's panel: what this schedule will actually do, and the switch that makes it
 * do it.
 *
 * The preview is the point. `mode: "every"` is translated to cron and cron is read in a timezone,
 * so "every 90 minutes" and "0 9 * * *" both mean something a little different from what they look
 * like — showing the next three real fire times is more honest than any amount of explanation, and
 * it is computed with the same `lib/schedule.ts` the scheduler step uses, so the preview and the
 * run cannot disagree.
 *
 * The switch posts to `/api/schedules`, which owns the row *and* the sleeping Workflow SDK run;
 * this component never writes the schedule itself. What it shows comes back through the live
 * `schedules.getForWorkflow` subscription, so a schedule enabled in another tab — or a `nextAt`
 * moved by the scheduler firing thirty seconds ago — lands here without a refresh.
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
  const [pending, setPending] = useState(false);

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

  // Decoration, not enforcement: the same check runs again in the route, which is what actually
  // decides (CLAUDE.md rule 3). Showing it here just means the switch does not have to be the way
  // you find out your plan will not run this.
  const verdict = useMemo(
    () => (spec && status ? validateSchedule(spec, status.plan, new Date(now ?? 0)) : null),
    [now, spec, status],
  );

  const enabled = status?.schedule?.enabled ?? false;

  const toggle = useCallback(
    (next: boolean) => {
      setPending(true);
      void fetch("/api/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowId, action: next ? "enable" : "pause" }),
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) {
            toast.error(payload.error ?? "Could not change this schedule");
            return;
          }
          toast.success(next ? "Schedule enabled" : "Schedule paused");
        })
        .catch(() => toast.error("Could not reach the server"))
        .finally(() => setPending(false));
    },
    [workflowId],
  );

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{enabled ? "Running" : "Paused"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {spec === null
              ? "Finish configuring the trigger above."
              : `Fires ${describeSchedule(spec)} — ${timezone}`}
          </p>
        </div>
        <Switch
          id="schedule-enabled"
          aria-label={enabled ? "Pause this schedule" : "Enable this schedule"}
          checked={enabled}
          disabled={pending || status === undefined || spec === null}
          onCheckedChange={toggle}
        />
      </div>

      {cron.length > 0 && (
        <p className="font-mono text-xs text-muted-foreground">{cron}</p>
      )}

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

      <p className="text-xs text-muted-foreground">
        Enabling schedules the workflow that is <em>saved</em>: edit the interval above, let the
        canvas save, then toggle this off and on again.
      </p>
    </div>
  );
}
