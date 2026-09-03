import type { Metadata } from "next";

import { RunsTable } from "@/components/runs/RunsTable";
import { WorkflowRunsHeader } from "@/components/runs/WorkflowRunsHeader";
import type { Id } from "@/convex/_generated/dataModel";

export const metadata: Metadata = {
  title: "Runs",
};

/**
 * A workflow's run history. The org guard lives in `app/(app)/layout.tsx` and the id is only
 * trusted as far as Convex: `executions.pageByWorkflow` re-checks the workflow against the caller's
 * organisation, so another org's id is `not_found` rather than an empty table.
 */
export default async function WorkflowRunsPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;
  const id = workflowId as Id<"workflows">;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <WorkflowRunsHeader workflowId={id} />
      <RunsTable workflowId={id} />
    </div>
  );
}
