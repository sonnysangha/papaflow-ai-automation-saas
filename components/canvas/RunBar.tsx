"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { HistoryIcon, KeyboardIcon, PlayIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { RunStatusBadge } from "@/components/runs/RunsTable";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NODES } from "@/nodes/registry";

import { NodeIcon } from "./node-icon";
import {
  CANVAS_SHORTCUTS,
  hasModifier,
  isTypingTarget,
  NODE_SEARCH_INPUT_ID,
} from "./shortcuts";

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

/**
 * How the last run ended, live from the `executions` subscription.
 *
 * `aria-live="polite"` on the wrapper rather than on the badge: the badge unmounts and remounts as
 * the status changes, and a live region has to be on screen *before* the change to announce it. So
 * the region is always there and only its contents move — "Running", then "Completed".
 */
function LastRun({ latest }: { latest: LatestExecution | undefined }) {
  return (
    <span
      aria-live="polite"
      aria-atomic
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={latest ? formatAbsoluteTime(latest.startedAt) : undefined}
    >
      {latest === undefined ? (
        <Skeleton className="h-5 w-28" />
      ) : latest === null ? (
        <span>No runs yet</span>
      ) : (
        <>
          <RunStatusBadge status={latest.status} />
          <span>{formatRelativeTime(latest.startedAt)}</span>
        </>
      )}
    </span>
  );
}

/** The `?` popover: the four bindings the canvas listens for, and nothing else. */
function ShortcutsPopover() {
  // ⌘ and Ctrl are shown together rather than sniffed from `navigator`: the handler accepts both,
  // and a platform guess that renders differently on the server is a hydration mismatch for a
  // detail nobody is confused by.
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" />}
      >
        <KeyboardIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverTitle className="text-sm font-medium">Keyboard shortcuts</PopoverTitle>
        <dl className="mt-2 grid gap-2">
          {CANVAS_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="flex items-center justify-between gap-3">
              <dt className="text-sm text-muted-foreground">{shortcut.description}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-4"
                  >
                    {key === "Mod" ? "⌘ / Ctrl" : key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

type RunBarProps = {
  workflowId: Id<"workflows">;
  /** The trigger node's type on the *saved* graph — the graph a run actually interprets. */
  triggerType: string | undefined;
  /** The Manual trigger's configured sample, shown in the payload box until the user edits it. */
  triggerSample?: string;
  latest: LatestExecution | undefined;
  runWorkflow: RunWorkflowAction;
  /** Opens the Builder chat. The editor owns whether the panel is showing. */
  onOpenBuilder: () => void;
  builderOpen: boolean;
};

/**
 * The strip above the canvas: which trigger starts this workflow, the sample payload the Manual
 * trigger sends, the Run button, and how the last run ended. Everything it shows about a run comes
 * from the live `executions` subscription the editor owns, so the badge updates while the run goes.
 */
export function RunBar({
  workflowId,
  triggerType,
  latest,
  runWorkflow,
  onOpenBuilder,
  builderOpen,
  triggerSample,
}: RunBarProps) {
  // What the user typed wins; until then the box mirrors the trigger node's own sample.
  const [typed, setTyped] = useState<string | null>(null);
  const sample = typed ?? triggerSample ?? "{}";
  const setSample = setTyped;
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

  const onRun = useCallback(() => {
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
  }, [isManual, runWorkflow, sample, workflowId]);

  const canRun = !pending && Boolean(triggerType);

  /**
   * The two shortcuts that belong to the run bar rather than to the graph.
   *
   * ⌘/Ctrl+Enter fires wherever you are, sample payload included — the whole point is running
   * without leaving the field you were editing. `/` is the opposite: it only means "search nodes"
   * when you are not already typing somewhere.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      if (event.key === "Enter" && hasModifier(event)) {
        if (!canRun) return;
        event.preventDefault();
        onRun();
        return;
      }

      if (event.key === "/" && !hasModifier(event) && !isTypingTarget(event.target)) {
        const search = document.getElementById(NODE_SEARCH_INPUT_ID);
        if (!(search instanceof HTMLInputElement)) return;
        event.preventDefault();
        search.focus();
        search.select();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRun, onRun]);

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
          disabled={!canRun}
          title={triggerType ? "Run the workflow (⌘/Ctrl + Enter)" : "Drag a trigger onto the canvas first"}
        >
          <PlayIcon />
          {pending ? "Starting…" : "Run"}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {/*
            Shown to everyone, on purpose: the panel itself is what puts up the plan wall
            (`<Show>` → `<UpgradeCard>`), so a free organisation discovers the feature by pressing
            the button rather than by never seeing it. The refusals that matter are `has()` in
            `POST /api/builder/session` and the plan check inside every Builder tool.
          */}
          <Button
            size="sm"
            variant={builderOpen ? "secondary" : "outline"}
            onClick={onOpenBuilder}
            aria-pressed={builderOpen}
          >
            <SparklesIcon />
            Build with AI
          </Button>
          <LastRun latest={latest} />
          <Link
            href={`/w/${workflowId}/runs`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <HistoryIcon />
            Runs
          </Link>
          <ShortcutsPopover />
        </div>
      </div>

      {runLimit ? (
        <UpgradeCard
          compact
          className="shrink-0 rounded-none border-x-0 border-t-0"
          title="Monthly run limit reached"
          description="This organisation has used every run its plan includes this month."
        />
      ) : null}
    </>
  );
}
