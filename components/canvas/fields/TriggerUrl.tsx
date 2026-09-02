"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Where this deployment answers webhooks. `NEXT_PUBLIC_APP_ORIGIN` is inlined at build time and is
 * what a deployed app must show (the custom domain, a preview URL); locally the browser's own
 * origin is right. Read at render rather than through an effect — the config panel only exists
 * once a node has been clicked, so there is no server render of this component to disagree with.
 */
function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured) return configured;
  return typeof window === "undefined" ? "" : window.location.origin;
}

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
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          value={url}
          readOnly
          spellCheck={false}
          aria-label="Webhook URL"
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Copy webhook URL"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => toast.success("Webhook URL copied"),
              () => toast.error("Could not copy — select the URL and copy it yourself"),
            );
          }}
        >
          <CopyIcon />
        </Button>
      </div>

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
    </div>
  );
}
