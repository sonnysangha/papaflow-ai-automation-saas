"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { StatusRing } from "@/components/canvas/StatusRing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NODES } from "@/nodes/registry";

/** One row of `api.steps.byExecution` — the whole `steps` document. */
type Step = FunctionReturnType<typeof api.steps.byExecution>[number];

/**
 * How long a step or a run took. Exported because the runs table shows the same shape for
 * executions, and this file is the leaf of the pair (`RunsTable` imports the sheet already, so
 * keeping the helper here is the direction that cannot make a cycle).
 */
export function formatDuration(startedAt: number, finishedAt?: number): string {
  if (finishedAt === undefined) return "—";

  const ms = Math.max(0, finishedAt - startedAt);
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

/** `steps.status` is exactly `NodeStatus` minus `idle`, so the canvas dot is reused verbatim. */
function StepStatusBadge({ status }: { status: Step["status"] }) {
  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <StatusRing status={status} className="ring-0" />
      {status}
    </Badge>
  );
}

/** The step's node type as a person reads it; skipped rows are recorded without one. */
function stepLabel(step: Step): string {
  if (step.nodeType.length === 0) return "Not reached";
  return NODES[step.nodeType]?.name ?? step.nodeType;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <ScrollArea className="max-h-56 rounded-md border border-border bg-muted/40">
        <pre className="p-2 font-mono text-xs break-words whitespace-pre-wrap">
          {value === undefined ? "—" : JSON.stringify(value, null, 2)}
        </pre>
      </ScrollArea>
    </div>
  );
}

/** The expanded half of a step row: what went in (redacted by `runNode`) and what came back. */
function StepDetail({ step }: { step: Step }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/30 p-3">
      <div className="flex flex-wrap gap-3">
        <JsonBlock label="Input" value={step.input} />
        <JsonBlock label="Output" value={step.output} />
      </div>
      {step.error ? (
        <p className="font-mono text-xs whitespace-pre-wrap text-destructive">{step.error}</p>
      ) : null}
    </div>
  );
}

function StepRows({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const detailId = `step-detail-${step._id}`;

  return (
    <>
      <TableRow>
        <TableCell className="w-8 pl-4">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <span className="sr-only">
              {open ? "Hide" : "Show"} input and output for {stepLabel(step)}
            </span>
          </Button>
        </TableCell>
        <TableCell>
          <span className="font-medium">{stepLabel(step)}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground" title={step.nodeId}>
            {step.nodeId.slice(0, 8)}
          </span>
        </TableCell>
        <TableCell>
          <StepStatusBadge status={step.status} />
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">{step.attempt}</TableCell>
        <TableCell className="text-muted-foreground tabular-nums">
          {formatDuration(step.startedAt, step.finishedAt)}
        </TableCell>
        <TableCell className="pr-4 text-destructive">
          <span className="block max-w-56 truncate" title={step.error}>
            {step.error ?? ""}
          </span>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell id={detailId} colSpan={6} className="px-4 pb-3 whitespace-normal">
            <StepDetail step={step} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

type StepsSheetProps = {
  executionId: Id<"executions">;
  /** Header chrome only — everything the sheet actually renders comes from `steps.byExecution`. */
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed?: () => void;
};

/**
 * Every step of one run, live. Opened from the runs table; the subscription means a run that is
 * still going fills in underneath you rather than needing the sheet reopened.
 */
export function StepsSheet({
  executionId,
  summary,
  open,
  onOpenChange,
  onClosed,
}: StepsSheetProps) {
  const steps = useQuery(api.steps.byExecution, { executionId });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed?.();
      }}
    >
      <SheetContent side="right" className="data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Run steps</SheetTitle>
          <SheetDescription>
            {summary ?? "One row per node, oldest first."}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {steps === undefined ? (
            <div className="flex flex-col gap-2 px-4" role="status" aria-label="Loading steps">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-9 w-full" />
              ))}
            </div>
          ) : steps.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">
              This run has not recorded a step yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pl-4">
                    <span className="sr-only">Expand</span>
                  </TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="pr-4">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step) => (
                  <StepRows key={step._id} step={step} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
