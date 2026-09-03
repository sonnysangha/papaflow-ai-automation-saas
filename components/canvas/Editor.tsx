"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeftIcon, LayoutGridIcon, Redo2Icon, SaveIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WorkflowStatusPill } from "@/components/shared/status";
import { TriggerChip } from "@/components/shared/TriggerChip";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/components/workflows/relative-time";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { parseFormSpec } from "@/nodes/triggers/form";
import { NODES } from "@/nodes/registry";

import { BuilderPanel } from "./BuilderPanel";
import { Canvas, type EditorControls } from "./Canvas";
import { EditorActionsMenu, editorMenuActions } from "./EditorMenu";
import { fromStoredGraph, type RunNodeState, type SaveState } from "./graph-io";
import { carryOverSteps, latestStepByNode, type RunStepRow } from "./last-run";
import { NodeSidebar } from "./NodeSidebar";
import {
  COMPACT_BUTTON,
  FORM_TRIGGER,
  RunBar,
  type PublishWorkflowAction,
  type RunWorkflowAction,
} from "./RunBar";
import { RunTimeline, type RunTimelineControls } from "./RunTimeline";
import { useIsMobile } from "./use-media-query";
import { useLeaveGuard } from "./use-leave-guard";

/** Stable identity for "no run yet", so the config panel does not re-memo on every render. */
const EMPTY_STEPS: RunStepRow[] = [];

/** The editor fills what is left of the viewport under the `h-14` app header. */
const SHELL = "flex h-[calc(100dvh-3.5rem)] flex-col";

/** What "Draft"/"Published" on the toolbar actually decides, in one sentence. */
const PUBLISH_HINT =
  "Published workflows respond to their triggers — webhooks, forms, schedules and chat messages. Drafts only run when you press Run.";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  conflict: "Conflict",
  error: "Not saved",
};

const SAVE_TONE: Record<SaveState, string> = {
  saved: "bg-muted-foreground/40",
  dirty: "bg-amber-500",
  saving: "animate-pulse bg-amber-500",
  conflict: "bg-blue-500",
  error: "bg-destructive",
};

/**
 * What the Save control says, in every arrangement of the toolbar.
 *
 * "Saved · 2m ago" once this session has actually written something; a canvas that opened clean and
 * was never touched just says "Saved", because it has no moment to point at.
 */
function saveLabel(state: SaveState, savedAt: number | null): string {
  return state === "saved" && savedAt !== null
    ? `Saved · ${formatRelativeTime(savedAt)}`
    : SAVE_LABEL[state];
}

/** Click the name to rename in place; Enter or blur saves, Escape puts it back. */
function WorkflowName({
  workflowId,
  name,
  className,
}: {
  workflowId: Id<"workflows">;
  name: string;
  /** How much room the name gets, which is the one thing that differs between the two toolbars. */
  className?: string;
}) {
  const rename = useMutation(api.workflows.rename);
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const commit = useCallback(() => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (cancelledRef.current || next.length === 0 || next === name) return;
    void rename({ id: workflowId, name: next }).catch(() => {
      toast.error("Could not rename the workflow");
    });
  }, [draft, name, rename, workflowId]);

  if (draft === null) {
    return (
      <button
        type="button"
        title={`${name} — click to rename`}
        onClick={() => {
          cancelledRef.current = false;
          setDraft(name);
        }}
        className={cn(
          // `text-left` because a button centres its text: the name has to sit where the input
          // that replaces it on a click will put the caret, not jump sideways when you tap it.
          "truncate rounded-md px-1.5 py-1 text-left text-sm font-medium hover:bg-muted/50",
          className ?? "max-w-[10rem] lg:max-w-72",
        )}
      >
        {name}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      value={draft}
      aria-label="Workflow name"
      className={cn("h-8", className ?? "w-[10rem] lg:w-72")}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          cancelledRef.current = true;
          setDraft(null);
        }
      }}
    />
  );
}

/**
 * Undo, Redo, Save, and where the graph stands.
 *
 * All three act on state the canvas owns, reached through the controls it reports up; until it has
 * mounted and sent them, the buttons are there but disabled rather than absent, so the toolbar does
 * not change shape a frame after it appears.
 *
 * A disabled button receives no pointer events, so Undo and Redo keep a plain `title` rather than a
 * tooltip that would never open in the state you most want to ask about it.
 */
function SaveControls({ controls, savedAt }: { controls: EditorControls | null; savedAt: number | null }) {
  const saveState = controls?.saveState ?? "saved";
  const dirty = controls?.dirty ?? false;
  const saving = saveState === "saving";
  const label = saveLabel(saveState, savedAt);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        title="Undo (⌘/Ctrl + Z)"
        disabled={!controls?.canUndo}
        onClick={() => controls?.undo()}
      >
        <Undo2Icon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        title="Redo (⌘/Ctrl + Shift + Z)"
        disabled={!controls?.canRedo}
        onClick={() => controls?.redo()}
      >
        <Redo2Icon />
      </Button>

      {/* One press, one undo step: `tidy` moves the nodes through the same `setNodes` a drag does,
          so Undo puts the pile back exactly as it was. `title` rather than a tooltip for the same
          reason as Undo and Redo — it is disabled on a canvas with nothing to arrange. */}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Tidy up"
        title="Tidy up layout — space every node out along its wires"
        disabled={!controls?.canTidy}
        onClick={() => controls?.tidy()}
      >
        <LayoutGridIcon />
      </Button>

      <Button
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty || saving}
        aria-label="Save"
        title={`${label} — save the canvas (⌘/Ctrl + S)`}
        onClick={() => void controls?.save()}
        className={COMPACT_BUTTON}
      >
        <SaveIcon />
        <span className="max-lg:hidden">Save</span>
      </Button>

      <span className="ml-0.5 hidden items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground lg:flex">
        <span aria-hidden className={cn("size-1.5 rounded-full", SAVE_TONE[saveState])} />
        <span role="status">{label}</span>
      </span>
    </>
  );
}

function EditorSkeleton() {
  return (
    <div className={SHELL}>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="ml-auto h-7 w-56" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-72 shrink-0 space-y-2 border-r border-border p-3 lg:block">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-14 w-full rounded-lg" />
          ))}
        </div>
        <div className="min-h-0 min-w-0 flex-1 p-3">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * The step rows the config panel reads: the live subscription, never emptier than the last thing
 * each node produced.
 *
 * `useQuery` answers `undefined` for a subscription whose args have just changed, and pressing Run
 * changes them — so between the click and the new run reaching a node, the query says nothing about
 * a node that has data, and the panel someone is typing in loses its Last run section and its
 * previews for several seconds. Carrying the previous rows over per node keeps them steady while
 * the run walks down the graph. The canvas is fed the raw `steps` instead: its rings are about the
 * run in progress and are meant to reset to idle for it.
 */
function useCarriedSteps(steps: readonly RunStepRow[] | undefined): readonly RunStepRow[] {
  // Kept together with the query result it was derived from, so a render that changed neither hands
  // back the same array identity and the config panel's memos hold.
  const [carried, setCarried] = useState<{
    from: readonly RunStepRow[] | undefined;
    rows: readonly RunStepRow[];
  }>(() => ({ from: steps, rows: steps ?? EMPTY_STEPS }));

  if (carried.from !== steps) {
    // State derived from a changing input: computed during the render that saw the change and
    // returned straight away, so this pass already reads the new rows. React re-runs the component
    // with the update before it commits anything.
    const rows = steps === undefined ? carried.rows : carryOverSteps(carried.rows, steps);
    setCarried({ from: steps, rows });
    return rows;
  }

  return carried.rows;
}

/**
 * The workflow editor: a live `workflows.get` subscription, the node palette and the canvas.
 * Save state is owned here so the header strip can report it while `Canvas` does the work, and so
 * are the two run subscriptions — the latest execution and its steps — which the RunBar reports
 * and the canvas paints onto its nodes.
 */
export function Editor({
  workflowId,
  runWorkflow,
  publishWorkflow,
}: {
  workflowId: Id<"workflows">;
  runWorkflow: RunWorkflowAction;
  publishWorkflow: PublishWorkflowAction;
}) {
  const workflow = useQuery(api.workflows.get, { id: workflowId });
  const latest = useQuery(api.executions.latestByWorkflow, { workflowId });
  // `latest` is undefined while it loads and null before the first run; neither has steps to ask
  // for. When a new run starts, this resubscribes and the canvas resets to idle for that run —
  // while `panelSteps` keeps the previous run's data in the config panel until the new one gets to
  // that node.
  const steps = useQuery(api.steps.byExecution, latest ? { executionId: latest._id } : "skip");
  const panelSteps = useCarriedSteps(steps);
  // Save, Undo and Redo live on the graph the canvas owns; it reports them up here so the header
  // strip can draw them. Null until the canvas has mounted and sent its first set.
  const [controls, setControls] = useState<EditorControls | null>(null);
  const dirty = controls?.dirty ?? false;
  const saveState = controls?.saveState ?? "saved";
  // Below `md` the palette has no column, the toolbar is two rows and the runs drawer stays shut:
  // three different arrangements of the same controls, so this is markup rather than a class.
  const isMobile = useIsMobile();
  // The runs drawer reports its own state up so the overflow menu can toggle the same drawer its
  // bar does — on a phone the bar is one line at the bottom of the screen and easy to miss.
  const [runsControls, setRunsControls] = useState<RunTimelineControls | null>(null);

  // The palette adds a node by asking the canvas, which is where the graph is. Kept in a ref as
  // well as in state so this callback has one identity for the life of the editor: the palette
  // would otherwise swap every card between a button and a div on the render the canvas mounts.
  const controlsRef = useRef<EditorControls | null>(null);
  const onControlsChange = useCallback((next: EditorControls) => {
    controlsRef.current = next;
    setControls(next);
  }, []);
  const addNode = useCallback((nodeType: string) => {
    controlsRef.current?.addNode(nodeType);
  }, []);

  // When this session last wrote the graph, so the toolbar can say "Saved · 2m ago" rather than
  // only "Saved". Stamped on the `saving` → `saved` transition, which is the only moment a save
  // actually landed; a canvas opened clean and never touched has nothing to report and says so by
  // leaving this null. The tick re-renders the relative time while it is on screen.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, setNow] = useState(0);
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (saveState === "saving") wasSavingRef.current = true;
    else if (wasSavingRef.current && saveState === "saved") {
      wasSavingRef.current = false;
      setSavedAt(Date.now());
    }
  }, [saveState]);
  useEffect(() => {
    if (savedAt === null || saveState !== "saved") return;
    const timer = window.setInterval(() => setNow((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [saveState, savedAt]);

  // The navigation the leave dialog is holding up, and the callback that lets it continue.
  const [leaving, setLeaving] = useState<{ proceed: () => void } | null>(null);
  const onGuard = useCallback((proceed: () => void) => setLeaving({ proceed }), []);
  useLeaveGuard({ enabled: dirty, onGuard });

  const discardAndLeave = useCallback(() => {
    const proceed = leaving?.proceed;
    setLeaving(null);
    proceed?.();
  }, [leaving]);

  const saveAndLeave = useCallback(() => {
    const proceed = leaving?.proceed;
    const save = controls?.save;
    setLeaving(null);
    if (!proceed || !save) return;
    void save().then((saved) => {
      // A refused save has already put its own dialog or toast up — the conflict is the user's to
      // settle, and leaving in the middle of it would be the wrong half of the choice they made.
      if (saved) proceed();
    });
  }, [controls, leaving]);
  // The Builder chat sits beside the canvas rather than over it: the point of the panel is watching
  // the graph grow while the agent talks, which a dialog would cover up.
  const [builderOpen, setBuilderOpen] = useState(false);

  // Selection, both ways round. The canvas owns it (`node.selected` inside `Canvas`), so the
  // timeline reads it through `selectedNodeId` and asks for it through `focusNode` — a request
  // rather than a value, carrying a nonce so clicking the same bar twice re-centres the canvas on a
  // node that is already selected.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusNode, setFocusNode] = useState<{ nodeId: string; nonce: number } | null>(null);
  const focusOnNode = useCallback((nodeId: string) => {
    setFocusNode((current) => ({ nodeId, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  // One entry per node the latest run touched: the status the ring shows, the branch handle the
  // canvas dims the other edges from, and the output the variable picker reads real paths off.
  //
  // A node on a Loop body has one row per pass, so the canvas paints the latest of them: the ring
  // follows the item being worked on rather than freezing on the first one. `latestStepByNode` is
  // the same "last row wins" rule the config panel's Last run section reads by.
  const runByNode = useMemo(() => {
    const byNode: Record<string, RunNodeState> = {};
    for (const [nodeId, step] of Object.entries(latestStepByNode(steps ?? []))) {
      byNode[nodeId] = {
        status: step.status,
        handle: step.handle,
        output: step.output,
        // Undefined while the step is still going, which is exactly what the node tooltip wants:
        // "Running" with no duration until there is one to report.
        durationMs:
          step.finishedAt === undefined ? undefined : step.finishedAt - step.startedAt,
      };
    }
    return byNode;
  }, [steps]);

  // The trigger of the *saved* graph, which is the graph a run interprets — a trigger the user has
  // dropped but not saved is not the real one yet, and `startRun` would not see it.
  const triggerType = useMemo(() => {
    if (!workflow) return undefined;
    const { nodes } = fromStoredGraph(workflow.graph);
    return nodes.find((node) => NODES[node.data.nodeType]?.category === "trigger")?.data.nodeType;
  }, [workflow]);

  // The saved Manual trigger's sample, so the run bar shows the payload a run will actually get.
  const triggerSample = useMemo(() => {
    if (!workflow) return undefined;
    const { nodes } = fromStoredGraph(workflow.graph);
    const trigger = nodes.find((node) => NODES[node.data.nodeType]?.category === "trigger");
    const sample = (trigger?.data.inputs as { sample?: unknown } | undefined)?.sample;
    return typeof sample === "string" ? sample : undefined;
  }, [workflow]);

  // The saved Form trigger's fields, so the run bar can open the test dialog with exactly what the
  // public page would ask for — parsed through the node's own schema the same way `getPublicForm`
  // is on the server, so defaults are filled in and a half-configured field does not reach the UI.
  const triggerForm = useMemo(() => {
    if (!workflow) return undefined;
    const { nodes } = fromStoredGraph(workflow.graph);
    const trigger = nodes.find((node) => NODES[node.data.nodeType]?.category === "trigger");
    if (trigger?.data.nodeType !== FORM_TRIGGER) return undefined;
    return parseFormSpec(trigger.data.inputs) ?? undefined;
  }, [workflow]);

  if (workflow === undefined) return <EditorSkeleton />;

  return (
    <ReactFlowProvider>
      <TooltipProvider delay={300}>
        <div className={SHELL}>
          {/*
            One row for the whole editor: where you are and what this workflow is on the left, what
            you can do to it on the right. `relative`, because the two things that have to be read
            rather than glanced at — a refused publish, the monthly run wall — hang under it instead
            of pushing the canvas down or wrapping the row. Nothing here stacks: below `lg` the
            labelled buttons drop their labels and the name gets narrower.
          */}
          {isMobile ? (
            /*
              Two rows on a phone, because the one row does not fit: the eight controls on the right
              of the desktop toolbar overflow a 390px screen by about a third of it. Row one is what
              this workflow *is*; row two is what you can do to it — the two buttons anyone came here
              to press, and everything else behind `⋯`. Same handlers, same gating, different shape.
              `relative` for the same reason the desktop row is: a refused publish and the monthly
              run wall hang under it.
            */
            <div className="relative flex shrink-0 flex-col gap-1.5 border-b border-border bg-background px-2 py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <Link
                  href="/w"
                  aria-label="All workflows"
                  className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                >
                  <ArrowLeftIcon />
                </Link>
                <WorkflowName
                  workflowId={workflow._id}
                  name={workflow.name}
                  className="min-w-0 flex-1"
                />
                <span title={PUBLISH_HINT} className="shrink-0">
                  <WorkflowStatusPill status={workflow.status} />
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <RunBar
                  layout="mobile"
                  workflowId={workflow._id}
                  status={workflow.status}
                  triggerType={triggerType}
                  triggerSample={triggerSample}
                  triggerForm={triggerForm}
                  latest={latest}
                  runWorkflow={runWorkflow}
                  publishWorkflow={publishWorkflow}
                  builderOpen={builderOpen}
                  onOpenBuilder={() => setBuilderOpen((open) => !open)}
                />
                <div className="ml-auto">
                  <EditorActionsMenu
                    actions={editorMenuActions({
                      workflowId: workflow._id,
                      canUndo: controls?.canUndo ?? false,
                      canRedo: controls?.canRedo ?? false,
                      canTidy: controls?.canTidy ?? false,
                      canSave: dirty && saveState !== "saving",
                      saveLabel: saveLabel(saveState, savedAt),
                      runsOpen: runsControls?.open ?? false,
                      onUndo: () => controls?.undo(),
                      onRedo: () => controls?.redo(),
                      onTidy: () => controls?.tidy(),
                      onSave: () => void controls?.save(),
                      onBuildWithAi: () => setBuilderOpen((open) => !open),
                      onToggleRuns: () => runsControls?.setOpen(!runsControls.open),
                    })}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      href="/w"
                      aria-label="All workflows"
                      className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                    />
                  }
                >
                  <ArrowLeftIcon />
                </TooltipTrigger>
                <TooltipContent>All workflows</TooltipContent>
              </Tooltip>

              <WorkflowName workflowId={workflow._id} name={workflow.name} />

              <span title={PUBLISH_HINT} className="shrink-0">
                <WorkflowStatusPill status={workflow.status} />
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                v{workflow.version}
              </span>
              {triggerType ? (
                <TriggerChip type={triggerType} className="hidden shrink-0 xl:inline-flex" />
              ) : null}

              <div className="ml-auto flex items-center gap-1.5">
                <SaveControls controls={controls} savedAt={savedAt} />
                <Separator orientation="vertical" className="mx-0.5 h-5" />
                <RunBar
                  workflowId={workflow._id}
                  status={workflow.status}
                  triggerType={triggerType}
                  triggerSample={triggerSample}
                  triggerForm={triggerForm}
                  latest={latest}
                  runWorkflow={runWorkflow}
                  publishWorkflow={publishWorkflow}
                  builderOpen={builderOpen}
                  onOpenBuilder={() => setBuilderOpen((open) => !open)}
                />
              </div>
            </div>
          )}

          {/* Three columns: the palette folds, the canvas takes what is left, and the settings panel
              (inside `Canvas`, beside the flow) appears only while a node is selected. */}
          <div className="flex min-h-0 flex-1">
            {/* Desktop only. On a phone the palette is a bottom sheet the canvas's floating
                "Add node" button opens — a 288px column on a 390px screen is not a canvas. */}
            {isMobile ? null : <NodeSidebar onPick={addNode} />}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <Canvas
                  key={workflow._id}
                  workflow={workflow}
                  runByNode={runByNode}
                  steps={panelSteps}
                  focusNode={focusNode}
                  onControlsChange={onControlsChange}
                  onSelectedNodeChange={setSelectedNodeId}
                  onBuildWithAi={() => setBuilderOpen(true)}
                />
              </div>
              {/* Under the canvas rather than in the toolbar: it is a chart of one run, and the bar
                  above is about starting the next one. */}
              <RunTimeline
                workflowId={workflow._id}
                graph={workflow.graph}
                selectedNodeId={selectedNodeId ?? undefined}
                onSelectNode={focusOnNode}
                latestRunId={latest?._id ?? null}
                latestStatus={latest?.status ?? null}
                onControlsChange={setRunsControls}
              />
            </div>

            {builderOpen ? (
              <BuilderPanel workflowId={workflow._id} onClose={() => setBuilderOpen(false)} />
            ) : null}
          </div>
        </div>

        {/*
          An in-app navigation, held. Three ways out and no default: the dialog cannot guess whether
          the half-drawn branch on the canvas is worth keeping. Cancel is the safe one and is what
          Escape and a click outside do.
        */}
        <AlertDialog
          open={leaving !== null}
          onOpenChange={(open) => {
            if (!open) setLeaving(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>You have unsaved changes</AlertDialogTitle>
              <AlertDialogDescription>
                Your changes to {workflow.name} are still only on this canvas. Leaving without saving
                throws them away.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={discardAndLeave}>
                Discard and leave
              </AlertDialogAction>
              <AlertDialogAction onClick={saveAndLeave}>Save and leave</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TooltipProvider>
    </ReactFlowProvider>
  );
}
