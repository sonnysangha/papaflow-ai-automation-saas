"use client";

import { useCallback, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

import { Canvas } from "./Canvas";
import type { SaveState } from "./graph-io";
import { NodeSidebar } from "./NodeSidebar";

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
      toast.error("Could not rename this workflow");
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
        <div className="min-w-0 flex-1 p-3">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * The workflow editor: a live `workflows.get` subscription, the node palette and the canvas.
 * Save state is owned here so the header strip can report it while `Canvas` does the work.
 */
export function Editor({ workflowId }: { workflowId: Id<"workflows"> }) {
  const workflow = useQuery(api.workflows.get, { id: workflowId });
  const [saveState, setSaveState] = useState<SaveState>("saved");

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
          <div className="min-w-0 flex-1">
            <Canvas key={workflow._id} workflow={workflow} onSaveStateChange={setSaveState} />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
