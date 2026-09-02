"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { HistoryIcon, PlayIcon } from "lucide-react";
import { toast } from "sonner";

import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { RunStatusBadge } from "@/components/runs/RunsTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NODES } from "@/nodes/registry";

import { NodeIcon } from "./node-icon";

/** `api.executions.latestByWorkflow`: the newest run, or null before the first one. */
type LatestExecution = FunctionReturnType<typeof api.executions.latestByWorkflow>;

/**
 * The Manual trigger's server action, handed down from the page. It is passed as a prop rather
 * than imported here so the `"use server"` module stays in the page's import graph, which is how
 * `withWorkflow()` discovers `runGraph` (page → actions.ts → engine-client → run-graph).
 */
export type RunWorkflowAction = (
  workflowId: string,
  sampleJson: string,
) => Promise<{ executionId: string; runId: string }>;

const MANUAL_TRIGGER = "manual.trigger";

/**
 * A failed run is either the plan wall or something unexpected. Server actions hand back an
 * `Error` whose message carries the `ConvexError` payload in development and a generic digest in
 * production, so the limit is recognised by its code rather than by an instanceof check.
 */
function isRunLimit(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes("run_limit");
}

function runErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isRunLimit(error)) return "Monthly run limit reached";
  return message.length > 0 ? message : "Could not start this run";
}

function LastRun({ latest }: { latest: LatestExecution | undefined }) {
  if (latest === undefined) return <Skeleton className="h-5 w-28" />;
  if (latest === null) return <span className="text-xs text-muted-foreground">No runs yet</span>;

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={formatAbsoluteTime(latest.startedAt)}
    >
      <RunStatusBadge status={latest.status} />
      {formatRelativeTime(latest.startedAt)}
    </span>
  );
}

type RunBarProps = {
  workflowId: Id<"workflows">;
  /** The trigger node's type on the *saved* graph — the graph a run actually interprets. */
  triggerType: string | undefined;
  latest: LatestExecution | undefined;
  runWorkflow: RunWorkflowAction;
};

/**
 * The strip above the canvas: which trigger starts this workflow, the sample payload the Manual
 * trigger sends, the Run button, and how the last run ended. Everything it shows about a run comes
 * from the live `executions` subscription the editor owns, so the badge updates while the run goes.
 */
export function RunBar({ workflowId, triggerType, latest, runWorkflow }: RunBarProps) {
  const [sample, setSample] = useState("{}");
  const [pending, startTransition] = useTransition();
  // Sticky once hit: the wall stays visible under the bar until a run actually starts, because a
  // toast that has faded is no explanation for a Run button that keeps doing nothing.
  const [runLimit, setRunLimit] = useState(false);

  const definition = triggerType ? NODES[triggerType] : undefined;
  const isManual = triggerType === MANUAL_TRIGGER;

  // Invalid JSON is not a blocker — `runWorkflow` falls back to `{}` — but the field says so.
  const sampleValid = useMemo(() => {
    try {
      JSON.parse(sample);
      return true;
    } catch {
      return false;
    }
  }, [sample]);

  function onRun() {
    startTransition(async () => {
      try {
        await runWorkflow(workflowId, isManual ? sample : "{}");
        setRunLimit(false);
      } catch (error) {
        console.error(error);
        setRunLimit(isRunLimit(error));
        toast.error(runErrorMessage(error));
      }
    });
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm">
          <NodeIcon name={definition?.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={triggerType ? "font-medium" : "text-muted-foreground"}>
            {definition?.name ?? triggerType ?? "No trigger yet"}
          </span>
        </span>

        {isManual ? (
          <Textarea
            rows={1}
            value={sample}
            spellCheck={false}
            aria-invalid={!sampleValid}
            aria-label="Sample JSON payload"
            title={
              sampleValid
                ? "Sample JSON sent to the trigger"
                : "Invalid JSON — the run starts with an empty payload"
            }
            onChange={(event) => setSample(event.target.value)}
            className="max-h-24 min-h-8 w-64 resize-none px-2 py-1.5 font-mono text-xs"
          />
        ) : null}

        <Button
          size="sm"
          onClick={onRun}
          disabled={pending || !triggerType}
          title={triggerType ? undefined : "Drag a trigger onto the canvas first"}
        >
          <PlayIcon />
          {pending ? "Starting…" : "Run"}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <LastRun latest={latest} />
          <Link
            href={`/w/${workflowId}/runs`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <HistoryIcon />
            Runs
          </Link>
        </div>
      </div>

      {runLimit && (
        <UpgradeCard
          compact
          className="shrink-0 rounded-none border-x-0 border-t-0"
          title="Monthly run limit reached"
          description="This organisation has used every run its plan includes this month."
        />
      )}
    </>
  );
}
