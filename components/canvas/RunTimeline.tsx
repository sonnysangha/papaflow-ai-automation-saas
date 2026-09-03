"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, GanttChartIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

import type { RunStepStatus } from "./last-run";
import { relativeTime } from "./last-run";
import {
  buildTimeline,
  formatOffset,
  formatSpan,
  graphNodeNames,
  type TimelineRow,
} from "./run-timeline";
import { statusLabel } from "./StatusRing";

/**
 * One run of this workflow, as a Gantt under the canvas.
 *
 * The runs page answers "did it work"; this answers "where did the time go", which is the question
 * a canvas cannot show and a table of durations only half answers. One row per step in execution
 * order on a shared axis that starts at the trigger, so a four-second wait between two nodes is a
 * four-second hole you can see rather than two numbers you have to subtract.
 *
 * Everything drawn here is arithmetic from `run-timeline.ts` — rows, percentages, ticks — so this
 * file is markup and the layout has tests. Colour carries status, and never on its own: every row
 * names its status in the hover card, the legend spells the ones in this run out, and the label
 * column is readable with no colour at all (the contrast relief the palette check asks for).
 */

/** Runs older than this many are not worth a dropdown; the runs page has the rest. */
const PICKER_LIMIT = 20;

/** Collapsed height, open default, and the range the drag handle allows. */
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 560;

/**
 * The three widths that have to agree, or the ruler, the grid lines and the bars drift apart.
 *
 * Every track is `flex-1` inside a row padded by `TRACK_INSET`, so all three span the same box, and
 * a percentage means the same thing in each. `GRID_INSET` is the same pair as absolute offsets,
 * because the grid lines are one overlay across the whole body rather than a border per row.
 */
const LABEL_COLUMN = "w-44 shrink-0";
const TRACK_INSET = "pr-3";
const GRID_INSET = "left-44 right-3";

type Execution = FunctionReturnType<typeof api.executions.listByWorkflow>["runs"][number];

/**
 * Bar fills, in the same colour language as `StatusRing` and the runs table. Status is a reserved
 * palette: these four never stand for "series 4" of anything.
 */
const BAR_TONE: Record<RunStepStatus, string> = {
  running: "bg-amber-500",
  waiting: "bg-blue-500",
  success: "bg-emerald-500",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/35",
};

/** An open bar has no right edge to draw, so it fades out and pulses instead of ending. */
const OPEN_TONE: Record<RunStepStatus, string> = {
  running: "bg-gradient-to-r from-amber-500 to-amber-500/15",
  waiting: "bg-gradient-to-r from-blue-500 to-blue-500/15",
  success: "bg-gradient-to-r from-emerald-500 to-emerald-500/15",
  failed: "bg-gradient-to-r from-destructive to-destructive/15",
  skipped: "bg-gradient-to-r from-muted-foreground/35 to-muted-foreground/10",
};

const RUN_TONE: Record<Execution["status"], string> = {
  queued: "bg-muted-foreground/40",
  running: "animate-pulse bg-amber-500",
  waiting: "bg-blue-500",
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/40",
};

/** Whether this run can still change — the only case where the axis has to keep moving. */
function isOpenRun(run: Execution | undefined): boolean {
  return (
    run !== undefined &&
    (run.status === "queued" || run.status === "running" || run.status === "waiting")
  );
}

/**
 * One clock, read as an external store rather than held in state: `Date.now()` in a render body is
 * impure, and a `setState` in an effect is a cascading render the linter is right about.
 */
const clock = { now: Date.now() };
const readClock = () => clock.now;

/**
 * The current time, refreshed every `everyMs` — or frozen when that is null.
 *
 * An open bar is drawn against "now", so a running step has to re-render about once a second. A
 * finished run must not, and a collapsed panel must not run a timer at all, which is what the null
 * is for. Re-subscribing (the interval changing) stamps the clock immediately, so opening the panel
 * on a run that started an hour ago does not draw an hour-old axis for a second first.
 */
function useTick(everyMs: number | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (everyMs === null) return () => {};
      clock.now = Date.now();
      const timer = setInterval(() => {
        clock.now = Date.now();
        onChange();
      }, everyMs);
      return () => clearInterval(timer);
    },
    [everyMs],
  );

  return useSyncExternalStore(subscribe, readClock, readClock);
}

/** "Manual · 2m ago · 1.2s" — one line per run in the picker. */
function runOption(run: Execution, now: number): string {
  const duration =
    run.finishedAt === undefined ? "running" : formatSpan(run.finishedAt - run.startedAt);
  return `${run.trigger.type} · ${relativeTime(run.startedAt, now)} · ${duration}`;
}

/** The statuses this run actually produced, in the order the legend reads best. */
const LEGEND_ORDER: readonly RunStepStatus[] = [
  "success",
  "running",
  "waiting",
  "failed",
  "skipped",
];

function Legend({ statuses }: { statuses: ReadonlySet<RunStepStatus> }) {
  const shown = LEGEND_ORDER.filter((status) => statuses.has(status));
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {shown.map((status) => (
        <span key={status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className={cn("h-2 w-3 rounded-[2px]", BAR_TONE[status])} />
          {statusLabel(status)}
        </span>
      ))}
    </div>
  );
}

/** One step: its names on the left, its bar on the axis, and the dead time in front of it. */
function Row({
  row,
  selected,
  onSelect,
}: {
  row: TimelineRow;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const duration = row.durationMs === null ? "still going" : formatSpan(row.durationMs);
  const ends = row.durationMs === null ? "—" : formatOffset(row.endMs);

  return (
    <div
      className={cn(
        "flex min-h-8 items-stretch border-b border-border/40 last:border-b-0",
        TRACK_INSET,
        selected && "bg-muted/60",
      )}
    >
      <div className={cn(LABEL_COLUMN, "min-w-0 py-1.5 pr-2 pl-3")}>
        <div className={cn("flex min-w-0 items-baseline gap-1.5", row.child && "pl-3")}>
          <span className="min-w-0 flex-1 truncate text-xs font-medium" title={row.label}>
            {row.label}
          </span>
          {row.pass ? (
            <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums" title="Loop pass">
              {row.pass}
            </span>
          ) : null}
        </div>
        {row.child ? null : (
          <p className="truncate pt-px font-mono text-[10px] text-muted-foreground" title={row.nodeKey}>
            {row.nodeKey}
          </p>
        )}
      </div>

      <div className="relative min-w-0 flex-1">
        {/* The hole between the previous step ending and this one starting — the whole point of a
            stepped chart. Drawn thin and recessive: it is context, not a mark. */}
        {row.gapWidthPct !== null && row.gapLeftPct !== null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-px -translate-y-1/2 border-t border-dashed border-muted-foreground/40"
            style={{ left: `${row.gapLeftPct}%`, width: `${row.gapWidthPct}%` }}
          />
        ) : null}

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => onSelect(row.nodeId)}
                aria-label={`${row.label} — ${statusLabel(row.status)}, ${duration}`}
                className="absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={{
                  left: `${row.leftPct}%`,
                  width: `${row.widthPct}%`,
                  minWidth: "6px",
                }}
              />
            }
          >
            <span
              aria-hidden
              className={cn(
                "h-2.5 w-full rounded-[4px] transition-opacity hover:opacity-80",
                row.open ? OPEN_TONE[row.status] : BAR_TONE[row.status],
                row.open && "animate-pulse",
              )}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="flex-col items-start gap-0.5">
            <span className="font-medium">
              {row.label} · {statusLabel(row.status)}
            </span>
            <span className="tabular-nums">
              starts {formatOffset(row.startMs)} · {duration} · ends {ends}
            </span>
            {row.gapMs === null ? null : (
              <span className="tabular-nums">{formatSpan(row.gapMs)} after the previous step</span>
            )}
            {row.attempt > 1 ? <span>attempt {row.attempt}</span> : null}
            {row.error ? <span className="max-w-[16rem] break-all">{row.error}</span> : null}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export type RunTimelineProps = {
  workflowId: Id<"workflows">;
  /** The saved graph, for the node labels a run does not record. */
  graph: unknown;
  /** Selects a node on the canvas — the same selection the config panel opens from. */
  onSelectNode: (nodeId: string) => void;
  /** The node the canvas has selected, so the matching rows read as "this one". */
  selectedNodeId?: string;
  /** The newest run's id and status — the panel opens by itself when there is one to show. */
  latestRunId?: string | null;
  latestStatus?: string | null;
};

export function RunTimeline({
  workflowId,
  graph,
  onSelectNode,
  selectedNodeId,
  latestRunId,
  latestStatus,
}: RunTimelineProps) {
  // Open whenever there is a run to show, and again the moment a new run starts; collapsing it by
  // hand sticks until the next run. Deriving `open` keeps this out of an effect: `collapsedFor`
  // remembers which run the user closed the panel on, so a newer id simply stops matching.
  const [collapsedFor, setCollapsedFor] = useState<string | null | undefined>(undefined);
  const [openedByUser, setOpenedByUser] = useState(false);
  const open = openedByUser || (Boolean(latestRunId) && collapsedFor !== latestRunId);
  const setOpen = (next: boolean) => {
    setOpenedByUser(next);
    if (!next) setCollapsedFor(latestRunId ?? null);
  };
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  // Null means "whatever is newest", which is what keeps the panel following a run you just started.
  const [pickedId, setPickedId] = useState<Id<"executions"> | null>(null);

  // Nothing is subscribed to until the panel is opened: an editor left on the canvas all day should
  // not hold a second run subscription for a chart nobody is looking at.
  const page = useQuery(api.executions.listByWorkflow, open ? { workflowId } : "skip");
  const runs = useMemo(() => page?.runs.slice(0, PICKER_LIMIT) ?? [], [page]);
  const run = useMemo(
    () => runs.find((entry) => entry._id === pickedId) ?? runs[0],
    [pickedId, runs],
  );
  const steps = useQuery(api.steps.byExecution, run ? { executionId: run._id } : "skip");

  // A second while a bar is still growing; half a minute otherwise, which is only there to keep
  // “just now” in the picker from going stale under someone reading the chart.
  const now = useTick(open ? (isOpenRun(run) ? 1_000 : 30_000) : null);
  const names = useMemo(() => graphNodeNames(graph), [graph]);

  const timeline = useMemo(() => {
    if (!run) return null;
    return buildTimeline({
      steps: steps ?? [],
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      now,
      names,
    });
  }, [names, now, run, steps]);

  const statuses = useMemo(
    () => new Set((timeline?.rows ?? []).map((row) => row.status)),
    [timeline],
  );

  // Dragging the top edge. Pointer capture rather than window listeners: the drag keeps working
  // when the cursor leaves the 6px grip, and releases itself if the pointer is lost.
  const dragRef = useRef<{ y: number; height: number } | null>(null);
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { y: event.clientY, height };
    },
    [height],
  );
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const next = start.height + (start.y - event.clientY);
    setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next)));
  }, []);
  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (!open) {
    return (
      <div className="flex shrink-0 justify-start border-t border-border bg-card px-2 py-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <GanttChartIcon className="size-3.5" />
          Runs
          {latestStatus ? <span className="text-muted-foreground/70">· latest {latestStatus}</span> : null}
          <ChevronUpIcon className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider delay={200}>
      <section aria-label="Run timeline" className="flex shrink-0 flex-col border-t border-border bg-card">
        {/* The grip. `touch-none` so a drag on a trackpad-less device does not scroll the page. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the run timeline"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="h-1.5 w-full shrink-0 cursor-row-resize touch-none bg-transparent hover:bg-border"
        />

        <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1.5 px-2 text-xs"
            aria-expanded
            onClick={() => setOpen(false)}
          >
            <GanttChartIcon className="size-3.5" />
            Runs
            <ChevronDownIcon className="size-3.5" />
          </Button>

          {page === undefined ? (
            <Skeleton className="h-7 w-56" />
          ) : runs.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              This workflow has not run yet. Press Run and the steps appear here.
            </span>
          ) : (
            <Select
              value={run?._id ?? null}
              onValueChange={(next) => {
                if (typeof next === "string") setPickedId(next as Id<"executions">);
              }}
            >
              <SelectTrigger size="sm" className="max-w-72 min-w-0" aria-label="Run">
                <SelectValue>
                  {(current: unknown) => {
                    const match = runs.find((entry) => entry._id === current) ?? run;
                    return match ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden
                          className={cn("size-1.5 shrink-0 rounded-full", RUN_TONE[match.status])}
                        />
                        <span className="truncate">{runOption(match, now)}</span>
                      </span>
                    ) : (
                      "Pick a run…"
                    );
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {runs.map((entry) => (
                  <SelectItem key={entry._id} value={entry._id}>
                    <span
                      aria-hidden
                      className={cn("size-1.5 shrink-0 rounded-full", RUN_TONE[entry.status])}
                    />
                    <span className="truncate">{runOption(entry, now)}</span>
                    <span className="sr-only">{entry.status}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Legend statuses={statuses} />

          <Link
            href={`/w/${workflowId}/runs`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "ml-auto h-6 gap-1.5 px-2 text-xs text-muted-foreground",
            )}
          >
            All runs
            <ExternalLinkIcon className="size-3.5" />
          </Link>
        </div>

        <div className="min-h-0 overflow-y-auto" style={{ height }}>
          {page === undefined || (timeline !== null && steps === undefined) ? (
            <div className="space-y-2 px-3 pb-3" role="status" aria-label="Loading the run">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-6 w-full" />
              ))}
            </div>
          ) : timeline === null ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground">
              Pick a run to see where its time went.
            </p>
          ) : timeline.rows.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground">
              This run has not recorded a step yet.
            </p>
          ) : (
            <div className="relative">
              {/* Sticky rather than a separate header row: the ruler and the bars then share one
                  scroll container, so they can never drift apart by a scrollbar's width. */}
              <div
                className={cn(
                  "sticky top-0 z-10 flex items-end border-b border-border bg-card",
                  TRACK_INSET,
                )}
              >
                <div className={cn(LABEL_COLUMN, "px-3 pb-1 text-[10px] text-muted-foreground")}>
                  Step
                </div>
                <div className="relative min-w-0 flex-1 pb-1">
                  {timeline.ticks.map((tick, index) => (
                    <span
                      key={tick.atMs}
                      className="absolute bottom-1 text-[10px] text-muted-foreground tabular-nums"
                      style={{
                        left: `${tick.leftPct}%`,
                        // Centred, except at the ends, where half a label would hang off the axis.
                        transform:
                          index === 0
                            ? undefined
                            : tick.leftPct > 95
                              ? "translateX(-100%)"
                              : "translateX(-50%)",
                      }}
                    >
                      {tick.label}
                    </span>
                  ))}
                  {/* Reserves the ruler's height: everything above it is absolute. */}
                  <span className="block h-4" />
                </div>
              </div>

              <div className="relative">
                {/* One overlay for the whole body rather than grid lines per row: recessive, and it
                    cannot fall out of step with the ruler above. */}
                <div aria-hidden className={cn("pointer-events-none absolute inset-y-0", GRID_INSET)}>
                  {timeline.ticks.map((tick) => (
                    <span
                      key={tick.atMs}
                      className="absolute inset-y-0 w-px bg-border/60"
                      style={{ left: `${tick.leftPct}%` }}
                    />
                  ))}
                </div>

                {timeline.rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    selected={row.nodeId === selectedNodeId}
                    onSelect={onSelectNode}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
