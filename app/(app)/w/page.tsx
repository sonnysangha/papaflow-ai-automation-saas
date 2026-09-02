import type { Metadata } from "next";

import { GettingStarted } from "@/components/workflows/GettingStarted";
import { NewWorkflowDialog } from "@/components/workflows/NewWorkflowDialog";
import { WorkflowList } from "@/components/workflows/WorkflowList";

export const metadata: Metadata = {
  title: "Workflows",
};

/**
 * The workflow index. The org guard lives in `app/(app)/layout.tsx`, and the list itself is a client
 * component so it can subscribe to Convex — this page is only the frame around it.
 */
export default function WorkflowsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Everything this organisation automates, newest first.
          </p>
        </div>
        <NewWorkflowDialog />
      </div>

      {/* Removes itself once a connection, a workflow and a run all exist. */}
      <GettingStarted />

      <WorkflowList />
    </div>
  );
}
