"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronRightIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { relativeTime, type LastRunStep } from "./last-run";
import { statusSummary, StatusRing } from "./StatusRing";

/** How often "just now" is allowed to become "1m ago" while the panel sits open. */
const TICK_MS = 30_000;

/** One clock for every panel that asks: a timer per instance would drift and multiply. */
let stamp = Date.now();

function subscribeToClock(onChange: () => void): () => void {
  stamp = Date.now();
  const timer = setInterval(() => {
    stamp = Date.now();
    onChange();
  }, TICK_MS);
  return () => clearInterval(timer);
}

const readClock = () => stamp;

/**
 * The current time as an external store rather than a `Date.now()` in the render body: the clock
 * is impure, and the run's age has to keep moving anyway while you sit in the panel.
 */
function useNow(): number {
  return useSyncExternalStore(subscribeToClock, readClock, readClock);
}

/** Pretty JSON, or `—` for a step that recorded nothing under this heading. */
function asJson(value: unknown): string {
  return value === undefined ? "—" : JSON.stringify(value, null, 2);
}

/**
 * One half of the last run: what went in, or what came out. Copy is the point of the button — the
 * usual next move is pasting the shape into a prompt or a JSON field.
 */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = asJson(value);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label={`Copy ${label.toLowerCase()}`}
          disabled={value === undefined}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => toast.success(`${label} copied`),
              () => toast.error("Could not copy — select the text and copy it yourself"),
            );
          }}
        >
          <CopyIcon />
        </Button>
      </div>
      <ScrollArea className="max-h-40 rounded-md border border-border bg-muted/40">
        <pre className="p-2 font-mono text-xs break-words whitespace-pre-wrap">{text}</pre>
      </ScrollArea>
    </div>
  );
}

export type LastRunSectionProps = {
  /** Namespaces the ids, so two panels in one document could never collide. */
  nodeId: string;
  /** This node's own step in the latest run, or null when the run never reached it. */
  run: LastRunStep | null;
  /** Whether anything above this node can be referenced — what the `{}` hint is about. */
  hasSources: boolean;
};

/**
 * The data this node last ran with, at the top of its settings.
 *
 * A config form is written against values you cannot see, which is the whole reason templates are
 * hard to get right: `{{ http_request_1.body.id }}` is a guess until something shows you the body.
 * So the panel opens on the last run's *resolved* input — the values that actually reached the
 * node, templates already substituted — and its output.
 *
 * Everything here comes from the client-visible `steps` projection: `input` was redacted by the
 * engine before it was stored (CLAUDE.md rule 1), so nothing secret can reach this component.
 */
export function LastRunSection({ nodeId, run, hasSources }: LastRunSectionProps) {
  // Open when there is something to read, shut when there is not: a run you just watched should be
  // in front of you, and an empty section should not push the form down. Stored as an override
  // rather than as the state itself, so a run finishing while you are configuring the node opens
  // the section under you — and closing it yourself still sticks.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? run !== null;
  const bodyId = `${nodeId}-last-run`;
  const now = useNow();

  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted/50"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <span className="text-xs font-medium">Last run</span>
        {run ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusRing status={run.status} labelled={false} className="ring-2" />
            {statusSummary(run.status, run.durationMs)}
          </span>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">Not run yet</span>
        )}
      </button>

      {open ? (
        <div id={bodyId} className="space-y-2 border-t border-border p-2.5">
          {run ? (
            <>
              <p className="text-xs text-muted-foreground">
                {relativeTime(run.finishedAt ?? run.startedAt, now)}
                {run.iteration === undefined ? "" : ` · loop pass ${run.iteration + 1}`}
              </p>
              <JsonBlock label="Input" value={run.input} />
              <JsonBlock label="Output" value={run.output} />
              {run.error ? (
                <p className="font-mono text-xs whitespace-pre-wrap text-destructive">{run.error}</p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              This node has no data yet. Run the workflow and its input and output appear here.
            </p>
          )}
          {hasSources ? (
            <p className="text-xs text-muted-foreground">
              Insert variables with <span className="font-mono">{"{}"}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
