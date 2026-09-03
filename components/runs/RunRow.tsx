import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { RunStatusPill, RUN_STATUS_TONE } from "@/components/shared/status";
import { TriggerChip } from "@/components/shared/TriggerChip";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";
import { cn } from "@/lib/utils";

import { formatClock, liveDuration } from "./format";
import { isOpenRun } from "./run-stats";

/** The columns one row draws. The projected `executions.pageBy*` row satisfies it. */
export type RunRowData = {
  _id: string;
  workflowId: string;
  status: string;
  trigger: { type: string };
  startedAt: number;
  finishedAt?: number;
  error?: string;
};

/**
 * One run.
 *
 * The row is the control: clicking anywhere on it opens the drawer, and so does Enter or Space once
 * it has focus, because a table you can only open with a mouse is a table half the people reading
 * it cannot use. The chevron is the visible affordance and carries the accessible name.
 *
 * `now` is passed in rather than read: the table ticks one clock for every row, so a run that is
 * still going counts up without every row owning a timer.
 */
export function RunRow({
  run,
  workflowName,
  showWorkflow = false,
  now,
  onOpen,
}: {
  run: RunRowData;
  /** The workflow's name, when the org-wide page is showing the column. */
  workflowName?: string;
  showWorkflow?: boolean;
  now: number;
  onOpen: () => void;
}) {
  const started = formatRelativeTime(run.startedAt, now);
  const absolute = formatAbsoluteTime(run.startedAt);
  const open = isOpenRun(run.status);
  const name = workflowName ?? "Deleted workflow";

  return (
    <TableRow
      tabIndex={0}
      aria-label={`Run of ${showWorkflow ? name : "this workflow"} started ${started}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <TableCell className="pl-4">
        <RunStatusPill status={run.status} />
      </TableCell>

      {showWorkflow ? (
        <TableCell className="max-w-32 lg:max-w-56">
          {workflowName === undefined ? (
            <span className="block truncate text-muted-foreground" title="Deleted workflow">
              {name}
            </span>
          ) : (
            <Link
              href={`/w/${run.workflowId}`}
              className="block truncate font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
              title={name}
              // The row opens the drawer; this one link goes to the canvas instead.
              onClick={(event) => event.stopPropagation()}
            >
              {name}
            </Link>
          )}
        </TableCell>
      ) : null}

      <TableCell className="hidden sm:table-cell">
        <TriggerChip type={run.trigger.type} />
      </TableCell>

      <TableCell title={absolute}>
        <span className="block">{started}</span>
        <span className="hidden font-mono text-xs text-muted-foreground md:block">
          {formatClock(run.startedAt)}
        </span>
      </TableCell>

      <TableCell
        className="font-mono text-muted-foreground tabular-nums"
        title={open ? "Still going" : undefined}
      >
        {liveDuration(run.startedAt, run.finishedAt, now)}
      </TableCell>

      <TableCell className={cn("hidden max-w-40 md:table-cell lg:max-w-72", RUN_STATUS_TONE.failed.text)}>
        <span className="block truncate" title={run.error}>
          {run.error ?? ""}
        </span>
      </TableCell>

      <TableCell className="w-12 pr-4 text-right">
        <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={onOpen}>
          <ChevronRightIcon />
          <span className="sr-only">Open the run started {started}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}
