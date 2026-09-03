"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { NODES } from "@/nodes/registry";

import { BuilderPanel } from "./BuilderPanel";
import { Canvas } from "./Canvas";
import { fromStoredGraph, type RunNodeState, type SaveState } from "./graph-io";
import { carryOverSteps, latestStepByNode, type RunStepRow } from "./last-run";
import { NodeSidebar } from "./NodeSidebar";
import { RunBar, type RunWorkflowAction } from "./RunBar";
import { RunTimeline } from "./RunTimeline";

/** Stable identity for "no run yet", so the config panel does not re-memo on every render. */
const EMPTY_STEPS: RunStepRow[] = [];

/** The editor fills what is left of the viewport under the 3.5rem app header. */
const SHELL = "flex h-[calc(100vh-3.5rem)] flex-col";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  conflict: "Conflict",
  error: "Not saved",
};

const SAVE_TONE: Record<SaveState, string> = {
  saved: "bg-muted-foreground/40",
  saving: "animate-pulse bg-amber-500",
  conflict: "bg-blue-500",
  error: "bg-destructive",
};

/** Click the name to rename in place; Enter or blur saves, Escape puts it back. */
function WorkflowName({ workflowId, name }: { workflowId: Id<"workflows">; name: string }) {
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
        title="Rename workflow"
        onClick={() => {
          cancelledRef.current = false;
          setDraft(name);
        }}
        className="max-w-72 truncate rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted"
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
      className="w-72"
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

function EditorSkeleton() {
  return (
    <div className={SHELL}>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 space-y-2 border-r border-border p-3">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-14 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            <Skeleton className="h-8 w-28" />
          </div>
          <div className="min-h-0 flex-1 p-3">
            <Skeleton className="h-full w-full" />
          </div>
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
}: {
  workflowId: Id<"workflows">;
  runWorkflow: RunWorkflowAction;
}) {
  const workflow = useQuery(api.workflows.get, { id: workflowId });
  const latest = useQuery(api.executions.latestByWorkflow, { workflowId });
  // `latest` is undefined while it loads and null before the first run; neither has steps to ask
  // for. When a new run starts, this resubscribes and the canvas resets to idle for that run —
  // while `panelSteps` keeps the previous run's data in the config panel until the new one gets to
  // that node.
  const steps = useQuery(api.steps.byExecution, latest ? { executionId: latest._id } : "skip");
  const panelSteps = useCarriedSteps(steps);
  const [saveState, setSaveState] = useState<SaveState>("saved");
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

  // The trigger of the *saved* graph, which is the graph a run interprets — an unsaved trigger the
  // user just dropped is 600ms away from being the real one, and `startRun` would not see it yet.
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

  if (workflow === undefined) return <EditorSkeleton />;

  return (
    <ReactFlowProvider>
      <div className={SHELL}>
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <WorkflowName workflowId={workflow._id} name={workflow.name} />
          <span className="text-xs text-muted-foreground">v{workflow.version}</span>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden className={cn("size-2 rounded-full", SAVE_TONE[saveState])} />
            <span role="status">{SAVE_LABEL[saveState]}</span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <NodeSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <RunBar
              workflowId={workflow._id}
              status={workflow.status}
              triggerType={triggerType}
              triggerSample={triggerSample}
              latest={latest}
              runWorkflow={runWorkflow}
              builderOpen={builderOpen}
              onOpenBuilder={() => setBuilderOpen((open) => !open)}
            />
            <div className="min-h-0 flex-1">
              <Canvas
                key={workflow._id}
                workflow={workflow}
                runByNode={runByNode}
                steps={panelSteps}
                focusNode={focusNode}
                onSaveStateChange={setSaveState}
                onSelectedNodeChange={setSelectedNodeId}
              />
            </div>
            {/* Under the canvas rather than in the run bar: it is a chart of one run, and the bar
                above is about starting the next one. */}
            <RunTimeline
              workflowId={workflow._id}
              graph={workflow.graph}
              selectedNodeId={selectedNodeId ?? undefined}
              onSelectNode={focusOnNode}
            />
          </div>

          {builderOpen ? (
            <BuilderPanel workflowId={workflow._id} onClose={() => setBuilderOpen(false)} />
          ) : null}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
