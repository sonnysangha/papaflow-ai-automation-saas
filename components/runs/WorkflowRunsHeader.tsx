"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeftIcon } from "lucide-react";

import { WorkflowStatusPill } from "@/components/shared/status";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

/**
 * The head of one workflow's runs page: whose history this is, and the way back.
 *
 * The name is a subscription rather than a server read so that renaming the workflow on the canvas
 * retitles this page too, and so the whole route stays static — the id in the URL is only ever
 * trusted as far as Convex, which re-checks it against the caller's organisation.
 */
export function WorkflowRunsHeader({ workflowId }: { workflowId: Id<"workflows"> }) {
  const workflow = useQuery(api.workflows.get, { id: workflowId });

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">Runs</p>
        <div className="flex min-w-0 items-center gap-2">
          {workflow === undefined ? (
            <Skeleton className="h-8 w-56" />
          ) : (
            <>
              <h1 className="truncate text-2xl font-semibold tracking-tight">{workflow.name}</h1>
              <WorkflowStatusPill status={workflow.status} />
            </>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Every run of this workflow, newest first. Open one to see what each node did.
        </p>
      </div>

      <Link
        href={`/w/${workflowId}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <ArrowLeftIcon />
        Back to canvas
      </Link>
    </div>
  );
}
