import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { RunStatusPill, RUN_STATUS_TONE } from "@/components/shared/status";
import { TriggerChip } from "@/components/shared/TriggerChip";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { runRowView, type RunRowData } from "./row-view";

export type { RunRowData } from "./row-view";

type RunRowProps = {
  run: RunRowData;
  /** The workflow's name, when the org-wide page is showing the column. */
  workflowName?: string;
  showWorkflow?: boolean;
  now: number;
  onOpen: () => void;
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
export function RunRow({ run, workflowName, showWorkflow = false, now, onOpen }: RunRowProps) {
  const view = runRowView(run, { workflowName, showWorkflow, now });

  return (
    <TableRow
      tabIndex={0}
      aria-label={view.label}
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
          {view.workflowHref === null ? (
            <span className="block truncate text-muted-foreground" title="Deleted workflow">
              {view.name}
            </span>
          ) : (
            <Link
              href={view.workflowHref}
              className="block truncate font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
              title={view.name}
              // The row opens the drawer; this one link goes to the canvas instead.
              onClick={(event) => event.stopPropagation()}
            >
              {view.name}
            </Link>
          )}
        </TableCell>
      ) : null}

      <TableCell className="hidden sm:table-cell">
        <TriggerChip type={run.trigger.type} />
      </TableCell>

      <TableCell title={view.absolute}>
        <span className="block">{view.started}</span>
        <span className="hidden font-mono text-xs text-muted-foreground md:block">
          {view.clock}
        </span>
      </TableCell>

      <TableCell
        className="font-mono text-muted-foreground tabular-nums"
        title={view.open ? "Still going" : undefined}
      >
        {view.duration}
      </TableCell>

      <TableCell className={cn("hidden max-w-40 md:table-cell lg:max-w-72", RUN_STATUS_TONE.failed.text)}>
        <span className="block truncate" title={run.error}>
          {run.error ?? ""}
        </span>
      </TableCell>

      <TableCell className="w-12 pr-4 text-right">
        <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={onOpen}>
          <ChevronRightIcon />
          <span className="sr-only">Open the run started {view.started}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * The same run as a block, for a phone, where six columns cannot fit and a horizontal scrollbar is
 * not an answer.
 *
 * A button rather than a row, so the whole card is one tap target that opens the drawer — and the
 * workflow's name is a smaller link *under* the status, deliberately not the headline, because on
 * a touch screen a full-width link across the top of a card is a trap: every tap meant for the run
 * would navigate away instead.
 */
export function RunCard({ run, workflowName, showWorkflow = false, now, onOpen }: RunRowProps) {
  const view = runRowView(run, { workflowName, showWorkflow, now });

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <button
        type="button"
        aria-label={view.label}
        onClick={onOpen}
        className="flex w-full items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <RunStatusPill status={run.status} />
            <TriggerChip type={run.trigger.type} />
          </span>

          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span title={view.absolute}>{view.started}</span>
            <span className="font-mono tabular-nums">{view.clock}</span>
            <span
              className="font-mono tabular-nums"
              title={view.open ? "Still going" : undefined}
            >
              {view.duration}
            </span>
          </span>
        </span>

        <ChevronRightIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </button>

      {showWorkflow ? (
        <p className="mt-2 min-w-0 text-xs">
          {view.workflowHref === null ? (
            <span className="text-muted-foreground">{view.name}</span>
          ) : (
            <Link
              href={view.workflowHref}
              className="inline-flex max-w-full truncate font-medium underline-offset-4 hover:underline focus-visible:underline"
              title={view.name}
            >
              {view.name}
            </Link>
          )}
        </p>
      ) : null}

      {run.error ? (
        <p className={cn("mt-2 line-clamp-2 text-xs break-words", RUN_STATUS_TONE.failed.text)}>
          {run.error}
        </p>
      ) : null}
    </div>
  );
}
