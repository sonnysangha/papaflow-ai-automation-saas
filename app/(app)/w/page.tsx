import type { Metadata } from "next";

import { GettingStarted } from "@/components/workflows/GettingStarted";
import { WorkflowList } from "@/components/workflows/WorkflowList";

export const metadata: Metadata = {
  title: "Workflows",
};

/**
 * The workflow index. The org guard lives in `app/(app)/layout.tsx`, and the list itself is a client
 * component so it can subscribe to Convex — this page is only the frame around it.
 *
 * The buttons that start a workflow sit in the list's toolbar rather than up here: they belong next
 * to the search and the filters they share a row with, and the empty state replaces all of it.
 */
export default function WorkflowsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Everything this organisation automates, newest first.
        </p>
      </div>

      {/* Removes itself once a connection, a workflow and a run all exist. */}
      <GettingStarted />

      <WorkflowList />
    </div>
  );
}
