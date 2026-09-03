"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  CopyIcon,
  ExternalLinkIcon,
  GanttChartIcon,
  ListIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { previewOf } from "@/components/canvas/last-run";
import type { RunStepStatus } from "@/components/canvas/last-run";
import { CopyableUrl } from "@/components/canvas/fields/CopyableUrl";
import {
  buildTimeline,
  formatSpan,
  graphNodeNames,
  type TimelineRow,
  type TimelineTick,
} from "@/components/canvas/run-timeline";
import { StatusRing } from "@/components/canvas/StatusRing";
import { RunStatusPill, RUN_STATUS_TONE, type RunStatus } from "@/components/shared/status";
import { TriggerChip } from "@/components/shared/TriggerChip";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FULL_WIDTH_SHEET } from "@/components/workflows/mobile-dialog";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { appOrigin } from "@/lib/app-origin";
import { PLAN_LABELS, isPlanSlug } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { liveDuration } from "./format";
import { isOpenRun } from "./run-stats";
import { useNow } from "./use-now";

/** `formatDuration` used to live here, and the runs table still imports it from this file. */
export { formatDuration } from "./format";

/** One row of `api.steps.byExecution` — the whole `steps` document. */
type Step = FunctionReturnType<typeof api.steps.byExecution>[number];

/** What the header says about the run. The projected `executions.pageBy*` row satisfies it. */
export type RunHeader = {
  _id: string;
  workflowId: string;
  status: string;
  trigger: { type: string };
  planSlug: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
};

/**
 * A step's status in the run palette: `success` is what a run calls `completed`, and a node the run
 * never reached is the same quiet grey as a cancelled run. One palette, two vocabularies.
 */
const STEP_TONE: Record<RunStepStatus, RunStatus> = {
  running: "running",
  waiting: "waiting",
  success: "completed",
  failed: "failed",
  skipped: "cancelled",
};

/** An icon-only copy button: names itself for screen readers and says so on hover. */
function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => {
              void navigator.clipboard.writeText(value).then(
                () => toast.success(`${label} copied`),
                () => toast.error("Could not copy — select it and copy it yourself"),
              );
            }}
          />
        }
      >
        <CopyIcon />
      </TooltipTrigger>
      <TooltipContent>Copy {label.toLowerCase()}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The bars: every step on one axis that starts at the trigger.
 *
 * The table answers "did it work"; this answers "where did the time go" without leaving the drawer.
 * All of the arithmetic is `buildTimeline` — the same helper the canvas Gantt uses — so this is
 * markup, and a bar is never thinner than a hairline however short the step was.
 */
function Timeline({ rows, ticks }: { rows: readonly TimelineRow[]; ticks: readonly TimelineTick[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2">
          <span
            className={cn(
              "w-28 shrink-0 truncate text-xs",
              row.child ? "pl-3 text-muted-foreground" : "text-foreground",
            )}
            title={row.label}
          >
            {row.label}
          </span>
          <div className="relative h-2 min-w-0 flex-1 rounded-full bg-muted/60">
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-0 rounded-full",
                RUN_STATUS_TONE[STEP_TONE[row.status]].dot,
                row.open && "animate-pulse",
              )}
              style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%`, minWidth: "2px" }}
            />
          </div>
          <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
            {row.durationMs === null ? "…" : formatSpan(row.durationMs)}
          </span>
        </div>
      ))}

      <div className="flex items-center gap-2" aria-hidden>
        <span className="w-28 shrink-0" />
        <div className="relative h-4 min-w-0 flex-1">
          {ticks.map((tick) => (
            <span
              key={tick.atMs}
              className={cn(
                "absolute top-0 font-mono text-[10px] text-muted-foreground tabular-nums",
                tick.leftPct <= 0
                  ? "translate-x-0"
                  : tick.leftPct >= 99
                    ? "-translate-x-full"
                    : "-translate-x-1/2",
              )}
              style={{ left: `${tick.leftPct}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
        <span className="w-14 shrink-0" />
      </div>
    </div>
  );
}

/** A labelled block of JSON — what went into a node (redacted by `runNode`) or what came back. */
function JsonPanel({ label, value }: { label: string; value: unknown }) {
  const text = value === undefined ? "" : JSON.stringify(value, null, 2);

  return (
    <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {text ? <CopyButton value={text} label={label} /> : null}
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {text || "—"}
      </pre>
    </div>
  );
}

/**
 * The URL that resumes this step, for as long as it is the one being waited on.
 *
 * The token (`steps.hookToken`, `${executionId}:${nodeId}`) is only on the row while the run is
 * suspended there, so this is the one place the concrete address exists: the config panel can only
 * show the pattern, because at design time no execution id has been minted yet.
 *
 * The token is the whole authorization — anyone holding this URL can resume this one node of this
 * one run — so it is shown, not hidden, but only to someone who can already read the run.
 */
function ResumeUrl({ step }: { step: Step }) {
  const url = `${appOrigin()}/api/wait/${step.hookToken ?? ""}`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Resume URL</span>
      <CopyableUrl value={url} label="Resume URL" />
      <p className="text-xs text-muted-foreground">
        POST to this URL to continue the run. The body becomes this node&rsquo;s output.
      </p>
    </div>
  );
}

/** Everything one step recorded, once you ask for it. */
function StepDetail({ step }: { step: Step }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
      {step.status === "waiting" && step.hookToken ? <ResumeUrl step={step} /> : null}

      <div className="flex min-w-0 flex-wrap gap-3">
        <JsonPanel label="Input" value={step.input} />
        <JsonPanel label="Output" value={step.output} />
      </div>

      {step.warnings && step.warnings.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Warnings</span>
          <ul
            className={cn(
              "max-h-72 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap",
              RUN_STATUS_TONE.running.text,
            )}
          >
            {step.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {step.error ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Error</span>
            <CopyButton value={step.error} label="Error" />
          </div>
          <pre
            className={cn(
              "max-h-72 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap",
              RUN_STATUS_TONE.failed.text,
            )}
          >
            {step.error}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One node's row in the list.
 *
 * Collapsed, it says the one thing you usually want — what the node produced — as a single line, so
 * a ten-step run reads without a single click. `Show details` is for when that is not enough.
 */
function StepListRow({ row, step }: { row: TimelineRow; step?: Step }) {
  const [open, setOpen] = useState(false);
  const detailId = `step-detail-${row.id}`;
  const preview = step ? previewOf(step.output) : "";

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <div className={cn("flex items-start gap-3 px-4 py-2.5", row.child && "pl-10")}>
        <StatusRing status={row.status} className="mt-1.5" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={cn("text-sm", row.child ? "text-muted-foreground" : "font-medium")}>
              {row.label}
            </span>
            {row.pass ? (
              <span className="text-xs text-muted-foreground tabular-nums" title="Loop pass">
                · {row.pass}
              </span>
            ) : null}
            {row.attempt > 1 ? (
              <span className="rounded border border-border px-1 text-[10px] text-muted-foreground tabular-nums">
                attempt {row.attempt}
              </span>
            ) : null}
          </div>

          {row.nodeKey ? (
            <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
              {row.nodeKey}
            </span>
          ) : null}

          {!open && row.error ? (
            <p className={cn("mt-1 truncate text-xs", RUN_STATUS_TONE.failed.text)} title={row.error}>
              {row.error}
            </p>
          ) : null}
          {!open && !row.error && preview ? (
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={preview}>
              {preview}
            </p>
          ) : null}
        </div>

        <span className="shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
          {row.durationMs === null ? "…" : formatSpan(row.durationMs)}
        </span>

        <Button
          variant="ghost"
          size="xs"
          aria-expanded={open}
          aria-controls={detailId}
          disabled={step === undefined}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Hide" : "Show details"}
          <span className="sr-only"> for {row.label}</span>
        </Button>
      </div>

      {open && step ? (
        <div id={detailId} className={cn("px-4 pb-3", row.child && "pl-10")}>
          <StepDetail step={step} />
        </div>
      ) : null}
    </li>
  );
}

/** The block above the timeline: which run this is, and where else it can be read. */
function RunHeaderBlock({
  run,
  name,
  workflowId,
  crossWorkflow,
  now,
}: {
  run: RunHeader;
  name: string;
  workflowId?: Id<"workflows">;
  crossWorkflow: boolean;
  now: number;
}) {
  const plan = isPlanSlug(run.planSlug) ? PLAN_LABELS[run.planSlug] : run.planSlug;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusPill status={run.status} size="md" />
        <TriggerChip type={run.trigger.type} />
        <span
          className="inline-flex h-6 items-center rounded-md border border-border bg-muted/40 px-1.5 text-xs text-muted-foreground"
          title="The organisation's plan when this run started"
        >
          {plan}
        </span>
      </div>

      <SheetDescription>
        Started {new Date(run.startedAt).toLocaleString()} ·{" "}
        <span className="font-mono tabular-nums">
          {liveDuration(run.startedAt, run.finishedAt, now)}
        </span>
        {run.finishedAt === undefined ? " so far" : ""}
      </SheetDescription>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/30 py-0.5 pr-0.5 pl-2">
          <span className="truncate font-mono text-xs text-muted-foreground" title={run._id}>
            {run._id}
          </span>
          <CopyButton value={run._id} label="Run id" />
        </span>

        {workflowId ? (
          <Link
            href={`/w/${workflowId}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <ExternalLinkIcon />
            Open canvas
          </Link>
        ) : null}

        {workflowId && crossWorkflow ? (
          <Link
            href={`/w/${workflowId}/runs`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <ListIcon />
            All runs of {name}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

type StepsSheetProps = {
  executionId: Id<"executions">;
  /**
   * The workflow this run belongs to, so the rows can show each node's own label. Left out when the
   * workflow has since been deleted — `workflows.get` answers `not_found` for one, and a drawer
   * that throws is worse than one showing "Set" instead of "Greet".
   */
  workflowId?: Id<"workflows">;
  /** The run's row, for the header. Without it the drawer still renders, minus the header block. */
  run?: RunHeader;
  /** Fallback name for a workflow `workflows.get` cannot answer for. */
  workflowName?: string;
  /** True on the org-wide page, where "all runs of this workflow" is somewhere else to go. */
  crossWorkflow?: boolean;
  /** Header chrome only, for callers that have nothing but a summary line. */
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed?: () => void;
};

/**
 * One run, in full: what it was, where its time went, and what every node put in and got back.
 *
 * Opened from the runs table, and live — the subscription means a run that is still going fills in
 * underneath you rather than needing the drawer reopened, and its bars keep growing while you read.
 */
export function StepsSheet({
  executionId,
  workflowId,
  run,
  workflowName,
  crossWorkflow = false,
  summary,
  open,
  onOpenChange,
  onClosed,
}: StepsSheetProps) {
  const steps = useQuery(api.steps.byExecution, { executionId });
  const workflow = useQuery(api.workflows.get, workflowId ? { id: workflowId } : "skip");

  const live = run ? isOpenRun(run.status) : (steps ?? []).some((step) => !step.finishedAt);
  const now = useNow(live);

  // One index for the whole drawer rather than a scan of the graph per row.
  const names = useMemo(() => graphNodeNames(workflow?.graph), [workflow?.graph]);
  const timeline = useMemo(
    () =>
      buildTimeline({
        steps: steps ?? [],
        startedAt: run?.startedAt ?? steps?.[0]?.startedAt ?? now,
        finishedAt: run?.finishedAt,
        now,
        names,
      }),
    [steps, run?.startedAt, run?.finishedAt, now, names],
  );
  // The timeline owns the order and the labels; the list looks the full row back up by id.
  const byId = useMemo(
    () => new Map<string, Step>((steps ?? []).map((step) => [step._id, step])),
    [steps],
  );

  const name = workflow?.name ?? workflowName ?? "Run";

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed?.();
      }}
    >
      <SheetContent
        side="right"
        className={cn(FULL_WIDTH_SHEET, "gap-0 data-[side=right]:sm:max-w-3xl")}
      >
        <TooltipProvider>
          <SheetHeader className="shrink-0 gap-3 border-b border-border pr-12">
            <SheetTitle className="truncate">{name}</SheetTitle>
            {run ? (
              <RunHeaderBlock
                run={run}
                name={name}
                workflowId={workflowId}
                crossWorkflow={crossWorkflow}
                now={now}
              />
            ) : (
              <SheetDescription>
                {summary ?? "One row per node, oldest first; a loop body has one per pass."}
              </SheetDescription>
            )}
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {steps === undefined ? (
              <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading steps">
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : steps.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                This run has not recorded a step yet.
              </p>
            ) : (
              <>
                <section className="border-b border-border p-4" aria-label="Step timeline">
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <GanttChartIcon className="size-3.5" aria-hidden />
                    Where the time went
                  </h3>
                  <Timeline rows={timeline.rows} ticks={timeline.ticks} />
                </section>

                <ul aria-label="Steps">
                  {timeline.rows.map((row) => (
                    <StepListRow key={row.id} row={row} step={byId.get(row.id)} />
                  ))}
                </ul>

                {run?.error ? (
                  <div className="p-4">
                    <div
                      className={cn(
                        "flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs",
                        RUN_STATUS_TONE.failed.text,
                      )}
                    >
                      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                      <p className="min-w-0 font-mono break-all whitespace-pre-wrap">
                        {run.error}
                      </p>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}
