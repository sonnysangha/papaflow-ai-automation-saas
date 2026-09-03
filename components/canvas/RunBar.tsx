"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronDownIcon,
  HistoryIcon,
  KeyboardIcon,
  PlayIcon,
  PowerIcon,
  PowerOffIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";

import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { RunStatusPill } from "@/components/shared/status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import type { FormSpec } from "@/nodes/triggers/form";
import { NODES } from "@/nodes/registry";

import { FormRunDialog } from "./FormRunDialog";
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

/**
 * The publish switch's server action, handed down the same way. It is an action rather than the
 * `workflows.setStatus` mutation because publishing a Schedule trigger also has to start (or
 * cancel) the durable scheduler run, which only the server can do.
 */
export type PublishWorkflowAction = (
  workflowId: string,
  publish: boolean,
) => Promise<
  | { ok: true; status: "active" | "paused"; scheduled: boolean; nextAt: number | null }
  | { ok: false; code: string; error: string }
>;

/**
 * Below `lg` a labelled toolbar button drops its label and becomes a square icon button — the row
 * must never wrap, and an icon with a tooltip is a smaller lie than a truncated word.
 */
export const COMPACT_BUTTON = "max-lg:size-7 max-lg:justify-center max-lg:px-0";

const MANUAL_TRIGGER = "manual.trigger";
/** Exported so `Editor` can find the Form trigger's node the same way this file gates on it. */
export const FORM_TRIGGER = "form.trigger";

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
      className="hidden items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground xl:flex"
      title={latest ? formatAbsoluteTime(latest.startedAt) : undefined}
    >
      {latest === undefined ? (
        <Skeleton className="h-5 w-28" />
      ) : latest === null ? (
        <span>No runs yet</span>
      ) : (
        <>
          <RunStatusPill status={latest.status} />
          <span>{formatRelativeTime(latest.startedAt)}</span>
        </>
      )}
    </span>
  );
}

type WorkflowStatus = Doc<"workflows">["status"];

/** The one sentence that answers "how do I trigger this?" — the question this control exists for. */
const PUBLISH_EXPLANATION =
  "Published workflows respond to their triggers — webhooks, forms, schedules and chat messages. Drafts only run when you press Run.";

/**
 * The publish switch. Where the workflow stands is said by the `<WorkflowStatusPill>` beside its
 * name in the toolbar; this is the button that moves it.
 *
 * It is what every trigger checks — the webhook route, the form submit route, the inbound event
 * routes and the scheduler all refuse a workflow that is not `active`. Run is deliberately exempt,
 * so the pill is never a reason the canvas stops working; it only decides whether the outside world
 * can start a run.
 *
 * It calls the `publishWorkflow` **server action** rather than `api.workflows.setStatus`, because a
 * Schedule trigger's "on" is not only a status: it is also a durable scheduler run that has to be
 * started (and cancelled) alongside it, which only the server can do. That is why publishing can be
 * refused — a plan that will not run a two-minute schedule refuses here, with a reason, and the
 * workflow stays unpublished rather than becoming a published workflow that silently never fires.
 *
 * "Unpublish" writes `paused` rather than `draft`: `draft` means "never published", and losing that
 * distinction would make the workflows list less honest than it is now.
 */
function PublishControl({
  workflowId,
  status,
  publishWorkflow,
  compact,
}: {
  workflowId: Id<"workflows">;
  status: WorkflowStatus;
  publishWorkflow: PublishWorkflowAction;
  /** Icon-only below `lg`, which is right in a crowded row and wrong in the mobile toolbar's own. */
  compact: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Kept on screen rather than only toasted: "your plan will not run this schedule" is something to
  // read twice and act on, and a toast that has faded is no explanation for a button that did
  // nothing. Cleared by the next attempt.
  const [error, setError] = useState<string | null>(null);
  const published = status === "active";

  const toggle = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await publishWorkflow(workflowId, !published);
        if (!result.ok) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        setError(null);
        toast.success(
          result.status === "paused"
            ? "Unpublished — its triggers are off"
            : result.scheduled
              ? "Published — the schedule is running"
              : "Published — its triggers are live",
        );
      } catch (cause) {
        console.error(cause);
        setError(null);
        toast.error("Could not change the publish status");
      }
    });
  }, [publishWorkflow, published, workflowId]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              variant={published ? "outline" : "secondary"}
              disabled={pending}
              onClick={toggle}
              className={compact ? COMPACT_BUTTON : undefined}
            />
          }
        >
          {published ? <PowerOffIcon /> : <PowerIcon />}
          <span className={compact ? "max-lg:hidden" : undefined}>
            {pending ? "Working…" : published ? "Unpublish" : "Publish"}
          </span>
        </TooltipTrigger>
        <TooltipContent>{PUBLISH_EXPLANATION}</TooltipContent>
      </Tooltip>

      {/* Kept on screen rather than only toasted, and out of the toolbar's one row: it hangs
          under the bar so a refused publish is still readable while you fix the schedule. */}
      {error ? (
        <p
          role="alert"
          className="absolute inset-x-0 top-full z-30 border-b border-border bg-background px-4 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </>
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
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
          />
        }
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
  /** Whether the outside world may start this workflow. Run works in every status. */
  status: WorkflowStatus;
  /** The trigger node's type on the *saved* graph — the graph a run actually interprets. */
  triggerType: string | undefined;
  /** The Manual trigger's configured sample, shown in the payload box until the user edits it. */
  triggerSample?: string;
  /** The saved Form trigger's fields, so Run can open the test dialog instead of the JSON box. */
  triggerForm?: FormSpec;
  latest: LatestExecution | undefined;
  runWorkflow: RunWorkflowAction;
  /** Publish/unpublish, which also starts or cancels a Schedule trigger's scheduler run. */
  publishWorkflow: PublishWorkflowAction;
  /** Opens the Builder chat. The editor owns whether the panel is showing. */
  onOpenBuilder: () => void;
  builderOpen: boolean;
  /**
   * Which toolbar this is sitting in.
   *
   * `"mobile"` is the second of two rows on a phone and carries only the two controls worth a
   * button there — Run and Publish, both with their labels, because there is room for them once
   * everything else has moved into the overflow menu. Everything this drops (Build with AI, the
   * last-run pill, the run history link, the shortcuts card) is offered by `Editor` from that menu
   * instead; nothing is lost and no handler changes.
   */
  layout?: "desktop" | "mobile";
};

/**
 * The run half of the editor toolbar: Run (with the Manual trigger's sample payload folded into a
 * popover beside it), publish, the Builder, the last run and the way to the run history.
 *
 * It renders a fragment rather than a bar of its own — `Editor` lays the single toolbar row out and
 * drops these controls into it, so there is one row rather than two and nothing wraps. The two
 * notices that must be read rather than glanced at (a refused publish, the monthly run wall) are
 * absolutely positioned under that row, which is why the toolbar is `relative`.
 *
 * Everything it shows about a run comes from the live `executions` subscription the editor owns, so
 * the pill updates while the run goes.
 */
export function RunBar({
  workflowId,
  status,
  triggerType,
  latest,
  runWorkflow,
  publishWorkflow,
  onOpenBuilder,
  builderOpen,
  triggerSample,
  triggerForm,
  layout = "desktop",
}: RunBarProps) {
  const mobile = layout === "mobile";
  // What the user typed wins; until then the box mirrors the trigger node's own sample.
  const [typed, setTyped] = useState<string | null>(null);
  const sample = typed ?? triggerSample ?? "{}";
  const setSample = setTyped;
  const [pending, startTransition] = useTransition();
  // Sticky once hit: the wall stays visible under the bar until a run actually starts, because a
  // toast that has faded is no explanation for a Run button that keeps doing nothing.
  const [runLimit, setRunLimit] = useState(false);
  // The form-answers dialog, opened by Run instead of running immediately.
  const [formDialogOpen, setFormDialogOpen] = useState(false);

  const definition = triggerType ? NODES[triggerType] : undefined;
  const isManual = triggerType === MANUAL_TRIGGER;
  const isForm = triggerType === FORM_TRIGGER && Boolean(triggerForm);

  // Invalid JSON is not a blocker — `runWorkflow` falls back to `{}` — but the field says so.
  const sampleValid = useMemo(() => {
    try {
      JSON.parse(sample);
      return true;
    } catch {
      return false;
    }
  }, [sample]);

  // Shared by the plain Run path (Manual's typed sample, or `{}` for every other trigger) and the
  // form dialog's "Run with these answers": one place owns starting the transition, clearing or
  // setting the run-limit wall, and toasting a failure, so both paths behave identically once a
  // payload is decided.
  const runWithPayload = useCallback(
    (payloadJson: string) => {
      startTransition(async () => {
        try {
          await runWorkflow(workflowId, payloadJson);
          setRunLimit(false);
        } catch (error) {
          console.error(error);
          setRunLimit(isRunLimit(error));
          toast.error(runErrorMessage(error));
        }
      });
    },
    [runWorkflow, workflowId],
  );

  const onRun = useCallback(() => {
    runWithPayload(isManual ? sample : "{}");
  }, [isManual, runWithPayload, sample]);

  // What pressing Run (or its shortcut) actually does: a Form trigger opens the answers dialog
  // instead of running blind, so a payload shaped like `{}` never reaches a workflow that expects
  // `values.<field>`. Every other trigger keeps running immediately, exactly as before.
  const onRunClick = useCallback(() => {
    if (isForm) {
      setFormDialogOpen(true);
      return;
    }
    onRun();
  }, [isForm, onRun]);

  const canRun = !pending && Boolean(triggerType);
  const runHint = !triggerType
    ? "Drag a trigger onto the canvas first"
    : isForm
      ? "Fill in a test submission (⌘/Ctrl + Enter)"
      : "Run the workflow (⌘/Ctrl + Enter)";

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
        onRunClick();
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
  }, [canRun, onRunClick]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="sm"
              onClick={onRunClick}
              disabled={!canRun}
              // A disabled button gets no pointer events, so the one state whose explanation
              // matters most — "there is no trigger yet" — falls back to a native title.
              title={canRun ? undefined : runHint}
              className={mobile ? undefined : COMPACT_BUTTON}
            />
          }
        >
          <PlayIcon />
          <span className={mobile ? undefined : "max-lg:hidden"}>
            {pending ? "Starting…" : "Run"}
          </span>
        </TooltipTrigger>
        <TooltipContent>{runHint}</TooltipContent>
      </Tooltip>

      {/*
        The Manual trigger's sample payload, folded into a popover beside Run rather than sitting in
        the toolbar as a text box. It is a per-run choice most people never change, and the row it
        used to live in is one line high now.
      */}
      {isManual ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Sample payload"
                title="The JSON this run starts with"
              />
            }
          >
            <ChevronDownIcon />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <PopoverTitle className="text-sm font-medium">
              {definition?.name ?? "Manual trigger"}
            </PopoverTitle>
            <Label htmlFor="papaflow-run-sample" className="mt-3 text-xs text-muted-foreground">
              Sample JSON sent to the trigger
            </Label>
            <Textarea
              id="papaflow-run-sample"
              rows={5}
              value={sample}
              spellCheck={false}
              aria-invalid={!sampleValid}
              onChange={(event) => setSample(event.target.value)}
              className="mt-1.5 max-h-56 w-full resize-none font-mono text-xs"
            />
            <p
              className={cn(
                "mt-1.5 text-xs",
                sampleValid ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {sampleValid
                ? "Reaches the graph as {{ trigger.… }}."
                : "Invalid JSON — the run starts with an empty payload."}
            </p>
          </PopoverContent>
        </Popover>
      ) : null}

      <PublishControl
        workflowId={workflowId}
        status={status}
        publishWorkflow={publishWorkflow}
        compact={!mobile}
      />

      {/* Everything below is desktop only. On a phone these live in the toolbar's overflow menu
          (`EditorMenu`) instead, where there is room to name them — nothing is dropped, and the
          handlers they call are the ones `Editor` passes to that menu. */}
      {mobile ? null : (
        <>
        {/*
          Shown to everyone, on purpose: the panel itself is what puts up the plan wall
          (`<Show>` → `<UpgradeCard>`), so a free organisation discovers the feature by pressing
          the button rather than by never seeing it. The refusals that matter are `has()` in
          `POST /api/builder/session` and the plan check inside every Builder tool.
        */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant={builderOpen ? "secondary" : "ghost"}
                onClick={onOpenBuilder}
                aria-pressed={builderOpen}
                className={COMPACT_BUTTON}
              />
            }
          >
            <SparklesIcon />
            <span className="max-lg:hidden">Build with AI</span>
          </TooltipTrigger>
          <TooltipContent>Describe the workflow and let the Builder draw it</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        <LastRun latest={latest} />

        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={`/w/${workflowId}/runs`}
                aria-label="Run history"
                className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              />
            }
          >
            <HistoryIcon />
          </TooltipTrigger>
          <TooltipContent>Run history</TooltipContent>
        </Tooltip>

        <ShortcutsPopover />
        </>
      )}

      {runLimit ? (
        <div className="absolute inset-x-0 top-full z-30">
          <UpgradeCard
            compact
            className="rounded-none border-x-0 border-t-0"
            title="Monthly run limit reached"
            description="This organisation has used every run its plan includes this month."
          />
        </div>
      ) : null}

      {triggerForm ? (
        <FormRunDialog
          workflowId={workflowId}
          spec={triggerForm}
          open={formDialogOpen}
          onOpenChange={setFormDialogOpen}
          pending={pending}
          onRun={runWithPayload}
        />
      ) : null}
    </>
  );
}
