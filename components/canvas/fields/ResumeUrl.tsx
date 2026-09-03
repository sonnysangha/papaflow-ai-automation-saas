"use client";

import { appOrigin } from "@/lib/app-origin";

/**
 * The Wait-for-webhook node's whole configuration: the shape of the URL that will resume it.
 *
 * Only the shape, because the address does not exist yet. The token is `${executionId}:${nodeId}`
 * and the execution id is minted when a run starts, so at design time there is nothing concrete to
 * copy — the concrete URL appears on the step row in the runs drawer the moment a run reaches this
 * node and starts waiting (`components/runs/StepsSheet.tsx`).
 */
export function ResumeUrlPattern({ id, nodeId }: { id: string; nodeId: string }) {
  return (
    <div className="space-y-1.5">
      <p
        id={id}
        className="rounded-md border border-border bg-muted/40 p-2 font-mono text-xs break-all"
      >
        {`${appOrigin()}/api/wait/<executionId>:${nodeId}`}
      </p>
      <p className="text-xs text-muted-foreground">
        Every run gets its own address, so this is the shape rather than a link you can use yet.
        Once a run stops here, open it in the runs drawer and copy the real one — anything POSTed to
        it wakes that run. What was sent arrives as{" "}
        <code className="font-mono">{"{{ <this node's key>.body }}"}</code>.
      </p>
    </div>
  );
}
