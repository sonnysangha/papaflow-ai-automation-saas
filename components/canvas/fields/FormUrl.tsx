"use client";

import { ExternalLinkIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import { appOrigin } from "@/lib/app-origin";

import { CopyableUrl } from "./CopyableUrl";

export type FormUrlProps = {
  id: string;
  workflowId: Id<"workflows">;
  /** Whether the workflow is published; a draft form renders but its submissions start nothing. */
  published: boolean;
};

/**
 * The Form trigger's public address: where people go to fill it in. Read-only — the page lives at
 * `/f/<workflow id>` and needs no secret, because a form is meant to be shared.
 */
export function FormUrl({ id, workflowId, published }: FormUrlProps) {
  const url = `${appOrigin()}/f/${workflowId}`;

  return (
    <div className="space-y-1.5">
      <CopyableUrl id={id} value={url} label="Form link" />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}
      >
        <ExternalLinkIcon />
        Open the form
      </a>
      <p className="text-xs text-muted-foreground">
        Share this link; every submission starts a run with the answers as{" "}
        <code className="font-mono">{"{{ trigger.… }}"}</code>. On localhost it opens in your own
        browser.
      </p>
      {!published && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          This workflow is a draft: the form renders, but submissions will not start a run until you
          press Publish.
        </p>
      )}
    </div>
  );
}
