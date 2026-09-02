"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRightIcon } from "lucide-react";

import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RUN_HISTORY_DAYS, RUN_HISTORY_FEATURE } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { formatDuration, StepsSheet } from "./StepsSheet";

/** One row of `api.executions.listByWorkflow` — the whole `executions` document. */
type Execution = FunctionReturnType<typeof api.executions.listByWorkflow>["runs"][number];
export type ExecutionStatus = Execution["status"];

/**
 * The same colour language as the canvas `StatusRing`, extended with the two statuses only a run
 * has: `queued` (created, not yet accepted by the Workflow SDK) and `cancelled`.
 */
const RUN_TONE: Record<ExecutionStatus, string> = {
  queued: "bg-muted-foreground/40",
  running: "animate-pulse bg-amber-500",
  waiting: "bg-blue-500",
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/40",
};

/** Status of one run, as a badge. Shared shape with the last-run badge in the canvas RunBar. */
export function RunStatusBadge({
  status,
  className,
}: {
  status: ExecutionStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 capitalize", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", RUN_TONE[status])} />
      {status}
    </Badge>
  );
}

/** "Manual · 1.2s" — the line under the sheet title, so the drawer says which run it opened. */
function runSummary(execution: Execution): string {
  const duration = formatDuration(execution.startedAt, execution.finishedAt);
  return `${execution.trigger.type} · started ${formatRelativeTime(execution.startedAt)} · ${duration}`;
}

function LoadingRuns() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading runs">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

/**
 * The note under a clipped list: this organisation has runs older than its plan shows. Nothing was
 * deleted — `executions.listByOrg` simply does not scan past the cutoff — so upgrading brings the
 * history straight back.
 */
function HistoryNote({ windowDays }: { windowDays: number }) {
  if (windowDays >= RUN_HISTORY_DAYS.extended) {
    return (
      <p className="text-xs text-muted-foreground">
        Showing the last {windowDays} days of runs.
      </p>
    );
  }

  return (
    <UpgradeCard
      compact
      feature={RUN_HISTORY_FEATURE}
      title={`Showing the last ${windowDays} days`}
      description={`This organisation has older runs. ${RUN_HISTORY_DAYS.extended}-day history is included from Pro.`}
    />
  );
}

/**
 * The table both runs pages render, with the sheet that opens a run's steps.
 *
 * `workflowNames` is only passed by the org-wide page — a workflow's own page already knows which
 * workflow it is looking at, so the column would be the same value on every row.
 */
function RunRows({
  runs,
  workflowNames,
}: {
  runs: readonly Execution[];
  workflowNames?: Record<string, string>;
}) {
  // The sheet outlives the click that opened it: `selected` is kept until the sheet has finished
  // animating closed, so the steps do not vanish mid-transition (the pattern `WorkflowList` uses).
  const [selected, setSelected] = useState<Execution | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Status</TableHead>
              {workflowNames && <TableHead>Workflow</TableHead>}
              <TableHead>Trigger</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Error</TableHead>
              <TableHead className="w-12 px-4">
                <span className="sr-only">Steps</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((execution) => {
              const openSteps = () => {
                setSelected(execution);
                setOpen(true);
              };

              return (
                <TableRow key={execution._id} className="cursor-pointer" onClick={openSteps}>
                  <TableCell className="px-4">
                    <RunStatusBadge status={execution.status} />
                  </TableCell>
                  {workflowNames && (
                    <TableCell>
                      <Link
                        href={`/w/${execution.workflowId}`}
                        className="underline-offset-4 hover:underline"
                        // The row opens the steps sheet; the link goes to the canvas instead.
                        onClick={(event) => event.stopPropagation()}
                      >
                        {workflowNames[execution.workflowId] ?? "Deleted workflow"}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {execution.trigger.type}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={formatAbsoluteTime(execution.startedAt)}
                  >
                    {formatRelativeTime(execution.startedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDuration(execution.startedAt, execution.finishedAt)}
                  </TableCell>
                  <TableCell className="text-destructive">
                    <span className="block max-w-64 truncate" title={execution.error}>
                      {execution.error ?? ""}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <Button variant="ghost" size="icon-sm" onClick={openSteps}>
                      <ChevronRightIcon />
                      <span className="sr-only">
                        View steps for the run started {formatRelativeTime(execution.startedAt)}
                      </span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {selected ? (
        <StepsSheet
          executionId={selected._id}
          // `selected` is the row as it was clicked; the subscription keeps going, so the header
          // reads from the live row when it is still in the list and falls back to the snapshot.
          summary={runSummary(runs.find((row) => row._id === selected._id) ?? selected)}
          open={open}
          onOpenChange={setOpen}
          onClosed={() => {
            if (!open) setSelected(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Every run of one workflow, newest first and live: a run started from the canvas appears here
 * without a reload. Clicking a row opens its steps in a sheet.
 */
export function RunsTable({ workflowId }: { workflowId: Id<"workflows"> }) {
  const page = useQuery(api.executions.listByWorkflow, { workflowId });

  if (page === undefined) return <LoadingRuns />;

  if (page.runs.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle>{page.clipped ? "No runs in this window" : "No runs yet"}</CardTitle>
            <CardDescription>
              {page.clipped
                ? `This workflow has not run in the last ${page.windowDays} days.`
                : "Press Run on the canvas and this workflow’s history starts here."}
            </CardDescription>
          </CardHeader>
        </Card>
        {page.clipped && <HistoryNote windowDays={page.windowDays} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <RunRows runs={page.runs} />
      {page.clipped && <HistoryNote windowDays={page.windowDays} />}
    </div>
  );
}

/** The same table for the whole organisation, with a column for which workflow each run belongs to. */
export function OrgRunsTable() {
  const page = useQuery(api.executions.listByOrg, {});

  if (page === undefined) return <LoadingRuns />;

  if (page.runs.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle>No runs yet</CardTitle>
            <CardDescription>
              Nothing has run in the last {page.windowDays} days. Open a workflow and press Run.
            </CardDescription>
          </CardHeader>
        </Card>
        {page.clipped && <HistoryNote windowDays={page.windowDays} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <RunRows runs={page.runs} workflowNames={page.workflowNames} />
      {page.clipped && <HistoryNote windowDays={page.windowDays} />}
    </div>
  );
}
