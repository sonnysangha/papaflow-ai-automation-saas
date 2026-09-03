"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronRightIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
 * `"{{ a.b }}: not found"` → `"{{ a.b }}"`. The engine writes the reason into the warning because
 * the row is read by an agent as well (`get_run`); on screen the heading already says it.
 */
function templateOf(warning: string): string {
  return warning.replace(/:\s*not found\s*$/, "");
}

/**
 * One half of the last run: what went in, or what came out. Copy is the point of the button — the
 * usual next move is pasting the shape into a prompt or a JSON field.
 *
 * A plain scrolling box rather than a `ScrollArea`: `ScrollArea`'s viewport is `height: 100%` of a
 * root whose own height is `auto`, so `max-h-*` on the root capped the *box* at ten rems while the
 * viewport kept growing to fit its content and spilled out the bottom — an HTTP response body wrote
 * itself straight over the Name and Key fields underneath. `overflow-auto` on the element that has
 * the `max-height` is the whole fix, and it is one element rather than four.
 *
 * `break-all` rather than `break-words`: the thing that overflows a 360px panel is a 400-character
 * URL or a base64 blob, and `overflow-wrap` only breaks a word when there is nowhere else to break
 * the *line* — inside `whitespace-pre-wrap` there frequently is. `min-w-0` on every ancestor up to
 * the panel is the other half: without it a flex or grid child sizes to its content's minimum and
 * pushes the whole panel wider rather than scrolling inside it.
 */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = asJson(value);

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="ml-auto shrink-0"
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
      <div className="max-h-56 min-w-0 overflow-auto overscroll-contain rounded-md border border-border bg-muted/40">
        <pre className="p-2 font-mono text-xs break-all whitespace-pre-wrap">{text}</pre>
      </div>
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
  // One-way, so the section never folds away under the cursor of someone typing in the form below
  // it: a node's row can go missing for a moment (a new run started and has not reached this node),
  // and a collapse followed by a re-expand is a layout jump in the middle of an edit. The panel is
  // keyed by node id, so selecting another node still starts from that node's own answer.
  const [everRan, setEverRan] = useState(run !== null);
  if (!everRan && run !== null) setEverRan(true);
  const open = override ?? everRan;
  const bodyId = `${nodeId}-last-run`;
  const now = useNow();

  return (
    <section className="min-w-0 rounded-lg border border-border">
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
        <div id={bodyId} className="min-w-0 space-y-2 border-t border-border p-2.5">
          {run ? (
            <>
              <p className="text-xs text-muted-foreground">
                {relativeTime(run.finishedAt ?? run.startedAt, now)}
                {run.iteration === undefined ? "" : ` · loop pass ${run.iteration + 1}`}
              </p>
              <JsonBlock label="Input" value={run.input} />
              {run.warnings && run.warnings.length > 0 ? (
                <p className="text-xs break-all text-amber-600 dark:text-amber-500">
                  Empty templates: {run.warnings.map(templateOf).join(", ")} — these resolved to
                  nothing, so the node ran with empty values there.
                </p>
              ) : null}
              <JsonBlock label="Output" value={run.output} />
              {run.error ? (
                <p className="max-h-40 overflow-auto font-mono text-xs break-all whitespace-pre-wrap text-destructive">
                  {run.error}
                </p>
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
