"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { StatusRing } from "@/components/canvas/StatusRing";
import { CopyableUrl } from "@/components/canvas/fields/CopyableUrl";
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
import { appOrigin } from "@/lib/app-origin";
import { NODES } from "@/nodes/registry";

/** One row of `api.steps.byExecution` — the whole `steps` document. */
type Step = FunctionReturnType<typeof api.steps.byExecution>[number];

/** What a node is called, both ways: the name you gave it and the name templates use. */
type NodeNames = { label: string; key: string };

/**
 * The names in the workflow's *current* graph, by node id.
 *
 * A run records `nodeId` and `nodeType`, not the label — the label is canvas state and can change
 * between runs — so the drawer reads it back from the graph. A node that has since been deleted or
 * renamed simply falls out of the map and the row falls back to the node definition's own name,
 * which is what this drawer showed before.
 */
function nodeNames(graph: unknown): Record<string, NodeNames> {
  const names: Record<string, NodeNames> = {};
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  for (const entry of Array.isArray(nodes) ? nodes : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, data } = entry as { id?: unknown; data?: unknown };
    if (typeof id !== "string" || typeof data !== "object" || data === null) continue;
    const { label, key } = data as { label?: unknown; key?: unknown };
    names[id] = {
      label: typeof label === "string" && label ? label : "",
      key: typeof key === "string" && key ? key : "",
    };
  }
  return names;
}

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
      {/* The badge already spells the status out, so the dot must not say it a second time. */}
      <StatusRing status={status} labelled={false} className="ring-0" />
      {status}
    </Badge>
  );
}

/** A tool call the Agent node made, written by `runNode` as `agent.tool:<name>`. */
const TOOL_PREFIX = "agent.tool:";

/**
 * What to call this row: the node's own label off the canvas ("Greet"), the node definition's name
 * when the graph no longer has it ("Set"), and the tool's name for an Agent sub-step.
 */
function stepLabel(step: Step, names?: NodeNames): string {
  if (step.nodeType.length === 0) return names?.label || "Not reached";
  // A child row has no registry entry to name it: the tool's own name is the whole label.
  if (step.nodeType.startsWith(TOOL_PREFIX)) return step.nodeType.slice(TOOL_PREFIX.length);
  return names?.label || NODES[step.nodeType]?.name || step.nodeType;
}

/** One node's row plus whatever it spawned — the Agent node's tool calls, in the order they ran. */
export type StepTree = { step: Step; substeps: Step[] };

/**
 * Groups the flat `steps` list into parents and their children.
 *
 * A child carries `parentStepId`; everything else is a top-level row. Order is preserved on both
 * levels (the query returns oldest first), and a child whose parent is missing from this page is
 * promoted rather than dropped — a row nobody can see is worse than one at the wrong indent.
 */
export function nestSteps(steps: readonly Step[]): StepTree[] {
  const trees: StepTree[] = [];
  const byId = new Map<string, StepTree>();

  for (const step of steps) {
    if (step.parentStepId) continue;
    const tree = { step, substeps: [] as Step[] };
    byId.set(step._id, tree);
    trees.push(tree);
  }

  for (const step of steps) {
    if (!step.parentStepId) continue;
    const parent = byId.get(step.parentStepId);
    if (parent) parent.substeps.push(step);
    else trees.push({ step, substeps: [] });
  }

  return trees;
}

/**
 * How many rows each node has in this run — one, unless it is on a Loop body, where it has one per
 * pass. Used as the denominator of "Set · 2/3", so a run still going shows the passes so far.
 */
function passCounts(steps: readonly Step[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const step of steps) {
    if (step.iteration === undefined) continue;
    counts[step.nodeId] = (counts[step.nodeId] ?? 0) + 1;
  }
  return counts;
}

/** `2/3` for the second of three passes over a loop body; nothing for a node that runs once. */
function passLabel(step: Step, passes: number): string | null {
  return step.iteration === undefined ? null : `${step.iteration + 1}/${Math.max(passes, 1)}`;
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
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Resume URL</span>
      <CopyableUrl value={url} label="Resume URL" />
      <p className="text-xs text-muted-foreground">
        POST to this URL to continue the run. The body becomes this node&rsquo;s output.
      </p>
    </div>
  );
}

/** The expanded half of a step row: what went in (redacted by `runNode`) and what came back. */
function StepDetail({ step }: { step: Step }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/30 p-3">
      {step.status === "waiting" && step.hookToken ? <ResumeUrl step={step} /> : null}
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

function StepRows({
  step,
  passes,
  names,
  substeps = [],
}: {
  step: Step;
  passes: number;
  /** The names this node carries on the canvas, when it is still there. */
  names?: NodeNames;
  /** The tool calls this step spawned. Rendered underneath it, indented, and never nested twice. */
  substeps?: Step[];
}) {
  const [open, setOpen] = useState(false);
  const detailId = `step-detail-${step._id}`;
  const pass = passLabel(step, passes);
  const child = step.parentStepId !== undefined;
  const label = stepLabel(step, names);

  return (
    <>
      <TableRow>
        <TableCell className={child ? "w-8 pl-10" : "w-8 pl-4"}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <span className="sr-only">
              {open ? "Hide" : "Show"} input and output for {label}
            </span>
          </Button>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className={child ? "text-muted-foreground" : "font-medium"}>{label}</span>
            {pass ? (
              <span className="text-xs text-muted-foreground tabular-nums" title="Loop pass">
                · {pass}
              </span>
            ) : null}
          </div>
          {/* The name templates address this node by, under the name you gave it — the same pair
              the canvas node and the config panel show. A tool call has neither. */}
          {child ? null : (
            <span
              className="mt-0.5 block font-mono text-xs text-muted-foreground"
              title={step.nodeId}
            >
              {names?.key || step.nodeType || step.nodeId.slice(0, 8)}
            </span>
          )}
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
      {substeps.map((substep) => (
        <StepRows key={substep._id} step={substep} passes={0} />
      ))}
    </>
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
  workflowId,
  summary,
  open,
  onOpenChange,
  onClosed,
}: StepsSheetProps) {
  const steps = useQuery(api.steps.byExecution, { executionId });
  const workflow = useQuery(api.workflows.get, workflowId ? { id: workflowId } : "skip");
  // One pass count per node, computed once for the whole table rather than per row.
  const passes = useMemo(() => passCounts(steps ?? []), [steps]);
  // Tool calls hang under the node that made them rather than sitting between unrelated nodes.
  const trees = useMemo(() => nestSteps(steps ?? []), [steps]);
  // One index for the whole table rather than a scan of the graph per row.
  const names = useMemo(() => nodeNames(workflow?.graph), [workflow?.graph]);

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
            {summary ?? "One row per node, oldest first; a loop body has one per pass."}
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
                {trees.map((tree) => (
                  <StepRows
                    key={tree.step._id}
                    step={tree.step}
                    passes={passes[tree.step.nodeId] ?? 0}
                    names={names[tree.step.nodeId]}
                    substeps={tree.substeps}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
