"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { appOrigin } from "@/lib/app-origin";

import { CopyableUrl } from "./CopyableUrl";

export type TriggerUrlProps = {
  id: string;
  workflowId: Id<"workflows">;
  /** From the workflow document, live: a rotate re-renders this through `workflows.get`. */
  webhookSecret: string;
};

/**
 * The Webhook trigger's whole configuration: the URL to call, a copy button and a rotate.
 *
 * Read-only on purpose — the secret is issued by Convex (`workflows.rotateWebhookSecret`), never
 * typed — and the value is rebuilt from props, so rotating in one tab updates every open canvas
 * through the same subscription that feeds the rest of the editor.
 */
export function TriggerUrl({ id, workflowId, webhookSecret }: TriggerUrlProps) {
  const rotateSecret = useMutation(api.workflows.rotateWebhookSecret);
  const [rotating, setRotating] = useState(false);

  const url = `${appOrigin()}/api/hooks/${workflowId}/${webhookSecret}`;

  return (
    <div className="space-y-1.5">
      <CopyableUrl id={id} value={url} label="Webhook URL" />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={rotating}
        className="w-full"
        onClick={() => {
          setRotating(true);
          void rotateSecret({ id: workflowId }).then(
            () => {
              setRotating(false);
              toast.success("New URL issued — the old one stops working now");
            },
            () => {
              setRotating(false);
              toast.error("Could not rotate the secret");
            },
          );
        }}
      >
        <RefreshCwIcon />
        {rotating ? "Rotating…" : "Rotate secret"}
      </Button>

      <p className="text-xs text-muted-foreground">
        GET or POST to this URL to start a run. A JSON body arrives as{" "}
        <code className="font-mono">{"{{ trigger.body }}"}</code>.
      </p>
      <p className="text-xs text-muted-foreground">
        On localhost the URL works from your own machine; publish the workflow so calls start runs.
      </p>
    </div>
  );
}
