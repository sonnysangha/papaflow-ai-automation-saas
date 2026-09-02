import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { RunsTable } from "@/components/runs/RunsTable";
import { buttonVariants } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";

export const metadata: Metadata = {
  title: "Runs",
};

/**
 * A workflow's run history. The org guard lives in `app/(app)/layout.tsx` and the id is only
 * trusted as far as Convex: `executions.listByWorkflow` re-checks the workflow against the caller's
 * organisation, so another org's id is `not_found` rather than an empty table.
 */
export default async function WorkflowRunsPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-muted-foreground">
            Every run of this workflow, newest first. Open one to see what each node did.
          </p>
        </div>
        <Link
          href={`/w/${workflowId}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeftIcon />
          Back to canvas
        </Link>
      </div>

      <RunsTable workflowId={workflowId as Id<"workflows">} />
    </div>
  );
}
