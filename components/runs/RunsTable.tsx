"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { InboxIcon, ListXIcon, LoaderIcon, type LucideIcon, PlayIcon } from "lucide-react";

import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { RunStatusPill } from "@/components/shared/status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RUN_HISTORY_DAYS, RUN_HISTORY_FEATURE } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { RunFiltersRow } from "./RunFilters";
import { RunCard, RunRow } from "./RunRow";
import { RunStatsSkeleton, RunStatsStrip } from "./RunStats";
import { StepsSheet } from "./StepsSheet";
import {
  filterRuns,
  isFiltered,
  NO_FILTERS,
  statusCounts,
  triggerOptions,
  type RunFilters,
} from "./run-filters";
import { isOpenRun, runStats } from "./run-stats";
import { useNow } from "./use-now";

/** One row of `api.executions.pageByOrg` — the projected execution, without the trigger payload. */
export type RunListItem = FunctionReturnType<typeof api.executions.pageByOrg>["page"][number];
export type ExecutionStatus = RunListItem["status"];

/** How many runs arrive per page, first and on every `Load more`. */
const PAGE_SIZE = 25;

/**
 * Status of one run, as a badge — the shared pill under its old name.
 *
 * A compatibility shim for anything still importing the badge from this file. Nothing in the app
 * does any more (the canvas run bar reads `RunStatusPill` directly), so it can go the next time
 * this file is touched.
 */
export function RunStatusBadge({
  status,
  className,
}: {
  status: ExecutionStatus | string;
  className?: string;
}) {
  return <RunStatusPill status={status} className={className} />;
}

/**
 * The note under a clipped list: this organisation has runs older than its plan shows. Nothing was
 * deleted — the queries simply do not scan past the cutoff — so upgrading brings the history back.
 */
function HistoryNote({ windowDays }: { windowDays: number }) {
  if (windowDays >= RUN_HISTORY_DAYS.extended) {
    return <p className="text-xs text-muted-foreground">Showing the last {windowDays} days of runs.</p>;
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

/** Nothing to show, and what to do about it. */
function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2">{action}</div>
    </div>
  );
}

/** The table's own shape while the first page loads: the same columns, greyed. */
function TableSkeleton({ showWorkflow }: { showWorkflow: boolean }) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border"
      role="status"
      aria-label="Loading runs"
    >
      <div className="flex flex-col divide-y divide-border">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-6 w-24 rounded-full" />
            {showWorkflow ? <Skeleton className="h-4 w-32" /> : null}
            <Skeleton className="hidden h-6 w-20 sm:block" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

type PaginationStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

/**
 * Everything both runs pages draw: the strip, the filters, the table, and the drawer a row opens.
 *
 * The rows are one live paginated subscription — a run started from the canvas appears at the top
 * without a reload, and the filters narrow what has been loaded rather than asking the server
 * again, so a status chip is instant. What "loaded" means is said out loud under the table.
 */
function RunsView({
  runs,
  status,
  loadMore,
  retention,
  workflowNames,
  workflowOptions,
  empty,
}: {
  runs: readonly RunListItem[];
  status: PaginationStatus;
  loadMore: (numItems: number) => void;
  /** The plan's retention window, once `executions.windowInfo` has answered. */
  retention?: { windowDays: number; clipped: boolean };
  /** Workflow id → name. Present only on the org-wide page, which shows the column. */
  workflowNames?: Record<string, string>;
  /** Every workflow in the org, for the filter dropdown. */
  workflowOptions?: readonly { id: string; name: string }[];
  /** What to show when the organisation (or workflow) has no runs at all. */
  empty: ReactNode;
}) {
  const [filters, setFilters] = useState<RunFilters>(NO_FILTERS);
  // The drawer outlives the click that opened it: `selected` is kept until the sheet has finished
  // animating closed, so the steps do not vanish mid-transition.
  const [selected, setSelected] = useState<RunListItem | null>(null);
  const [open, setOpen] = useState(false);

  const showWorkflow = workflowNames !== undefined;
  const live = runs.some((run) => isOpenRun(run.status));
  const now = useNow(live);

  const visible = useMemo(
    () => filterRuns(runs, filters, workflowNames),
    [runs, filters, workflowNames],
  );
  const stats = useMemo(() => runStats(runs, now), [runs, now]);
  const counts = useMemo(() => statusCounts(runs), [runs]);
  const triggers = useMemo(() => triggerOptions(runs), [runs]);

  if (status === "LoadingFirstPage") {
    return (
      <div className="flex flex-col gap-6">
        <RunStatsSkeleton />
        <TableSkeleton showWorkflow={showWorkflow} />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {empty}
        {retention?.clipped ? <HistoryNote windowDays={retention.windowDays} /> : null}
      </div>
    );
  }

  const selectedRun = selected ? (runs.find((row) => row._id === selected._id) ?? selected) : null;

  return (
    <div className="flex flex-col gap-6">
      <RunStatsStrip stats={stats} windowDays={retention?.windowDays} />

      <div className="flex flex-col gap-4">
        <RunFiltersRow
          filters={filters}
          onChange={setFilters}
          counts={counts}
          triggers={triggers}
          workflows={workflowOptions}
        />

        <div className="overflow-hidden rounded-xl border border-border">
          {visible.length === 0 ? (
            // Inside the box, not instead of it: `Load more` stays reachable, because the run you
            // are looking for is often just older than the page you have loaded.
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <ListXIcon className="size-5 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">No runs match</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Nothing loaded fits these filters. Clear them, or load more history.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setFilters(NO_FILTERS)}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              {/* Below `md` the same runs are stacked blocks: six columns do not fit a phone, and a
                  table that scrolls sideways hides the two things the page is for — how long it
                  took, and what went wrong. Same rows, same clock, same `runRowView`. */}
              <ul className="flex flex-col gap-2 p-2 md:hidden" aria-label="Runs">
                {visible.map((run) => (
                  <li key={run._id}>
                    <RunCard
                      run={run}
                      showWorkflow={showWorkflow}
                      workflowName={workflowNames?.[run.workflowId]}
                      now={now}
                      onOpen={() => {
                        setSelected(run);
                        setOpen(true);
                      }}
                    />
                  </li>
                ))}
              </ul>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Status</TableHead>
                      {showWorkflow ? <TableHead>Workflow</TableHead> : null}
                      <TableHead className="hidden sm:table-cell">Trigger</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="hidden md:table-cell">Error</TableHead>
                      <TableHead className="w-12 pr-4">
                        <span className="sr-only">Open</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((run) => (
                      <RunRow
                        key={run._id}
                        run={run}
                        showWorkflow={showWorkflow}
                        workflowName={workflowNames?.[run.workflowId]}
                        now={now}
                        onOpen={() => {
                          setSelected(run);
                          setOpen(true);
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {isFiltered(filters)
                ? `Showing ${visible.length} of ${runs.length} loaded runs`
                : status === "Exhausted"
                  ? `Showing all ${runs.length} runs in this window`
                  : `Showing ${runs.length} of many`}
            </p>
            {status === "Exhausted" ? null : (
              <Button
                variant="outline"
                size="sm"
                disabled={status === "LoadingMore"}
                onClick={() => loadMore(PAGE_SIZE)}
              >
                {status === "LoadingMore" ? (
                  <>
                    <LoaderIcon className="animate-spin" />
                    Loading
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            )}
          </div>
        </div>

        {retention?.clipped ? <HistoryNote windowDays={retention.windowDays} /> : null}
      </div>

      {selected && selectedRun ? (
        <StepsSheet
          executionId={selected._id}
          // Only when the workflow is still there: the org-wide table lists runs of deleted
          // workflows too, and `workflows.get` answers `not_found` for one.
          workflowId={
            showWorkflow && workflowNames?.[selected.workflowId] === undefined
              ? undefined
              : selected.workflowId
          }
          // `selected` is the row as it was clicked; the subscription keeps going, so the header
          // reads from the live row while it is still in the list and falls back to the snapshot.
          run={selectedRun}
          workflowName={workflowNames?.[selected.workflowId]}
          crossWorkflow={showWorkflow}
          open={open}
          onOpenChange={setOpen}
          onClosed={() => {
            if (!open) setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Every run of one workflow, newest first and live: a run started from the canvas appears here
 * without a reload. Clicking a row opens its steps in a drawer.
 */
export function RunsTable({ workflowId }: { workflowId: Id<"workflows"> }) {
  const page = usePaginatedQuery(
    api.executions.pageByWorkflow,
    { workflowId },
    { initialNumItems: PAGE_SIZE },
  );
  const retention = useQuery(api.executions.windowInfo, { workflowId });

  return (
    <RunsView
      runs={page.results}
      status={page.status}
      loadMore={page.loadMore}
      retention={retention}
      empty={
        <EmptyState
          icon={PlayIcon}
          title={retention?.clipped ? "No runs in this window" : "No runs yet"}
          hint={
            retention?.clipped
              ? `This workflow has not run in the last ${retention.windowDays} days.`
              : "Press Run on the canvas and this workflow's history starts here."
          }
          action={
            <Link
              href={`/w/${workflowId}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <PlayIcon />
              Open the canvas
            </Link>
          }
        />
      }
    />
  );
}

/** The same table for the whole organisation, with a column for which workflow each run belongs to. */
export function OrgRunsTable() {
  const page = usePaginatedQuery(api.executions.pageByOrg, {}, { initialNumItems: PAGE_SIZE });
  const retention = useQuery(api.executions.windowInfo, {});
  const workflows = useQuery(api.workflows.list, {});

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const workflow of workflows ?? []) map[workflow._id] = workflow.name;
    return map;
  }, [workflows]);

  const options = useMemo(
    () => (workflows ?? []).map((workflow) => ({ id: workflow._id as string, name: workflow.name })),
    [workflows],
  );

  return (
    <RunsView
      // The names arrive on their own subscription: rows would flash "Deleted workflow" if the
      // table drew before they landed, so the first page waits for both.
      runs={page.results}
      status={workflows === undefined ? "LoadingFirstPage" : page.status}
      loadMore={page.loadMore}
      retention={retention}
      workflowNames={names}
      workflowOptions={options}
      empty={
        <EmptyState
          icon={InboxIcon}
          title="No runs yet"
          hint={`Nothing has run in the last ${retention?.windowDays ?? RUN_HISTORY_DAYS.base} days. Open a workflow and press Run — every node lights up as it goes, and lands here when it is done.`}
          action={
            <Link href="/w" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <PlayIcon />
              Go to workflows
            </Link>
          }
        />
      }
    />
  );
}
