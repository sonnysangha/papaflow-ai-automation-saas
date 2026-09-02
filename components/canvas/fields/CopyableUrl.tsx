"use client";

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type CopyableUrlProps = {
  id?: string;
  value: string;
  /** Names the field for screen readers, and the copy button that sits next to it. */
  label: string;
  /** What the toast says on success. Defaults to `${label} copied`. */
  copiedMessage?: string;
};

/**
 * A URL the app issues and the user copies: read-only, monospaced, with a copy button.
 *
 * Shared by the Webhook trigger's URL, the Wait-for-webhook node's pattern and the concrete resume
 * URL on a waiting step row, so all three look and behave the same wherever they appear. Selecting
 * on focus matters as much as the button does — clipboard writes are blocked in some browsers and
 * every embedded view, and the fallback has to be "select it and press ⌘C".
 */
export function CopyableUrl({ id, value, label, copiedMessage }: CopyableUrlProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        value={value}
        readOnly
        spellCheck={false}
        aria-label={label}
        className="font-mono text-xs"
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => toast.success(copiedMessage ?? `${label} copied`),
            () => toast.error("Could not copy — select the URL and copy it yourself"),
          );
        }}
      >
        <CopyIcon />
      </Button>
    </div>
  );
}
