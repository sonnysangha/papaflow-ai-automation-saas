"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { CheckIcon, PlayIcon, PlugZapIcon, XIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import { NewWorkflowDialog } from "./NewWorkflowDialog";

/**
 * The three things between a new workspace and a finished run, ticking themselves off from live
 * Convex data: a connection exists, a workflow exists, a run has happened.
 *
 * It is a real sequence — you cannot run a workflow you have not drawn — which is why the steps
 * are numbered. Once all three are done it disappears on its own, and it can be dismissed before
 * then; the dismissal is a browser preference rather than workspace state, because it is about
 * this reader and not about the organisation.
 */

const DISMISS_KEY = "papaflow:getting-started-dismissed";

/**
 * "Has this reader hidden the panel" as an external store, because that is what `localStorage` is:
 * state React does not own, which does not exist while the page is rendered on the server.
 * `useSyncExternalStore` gives the server and the first hydration pass `false` and swaps in the
 * real answer immediately afterwards, so there is no mismatch to suppress and no effect that sets
 * state on mount.
 */
let dismissListeners: (() => void)[] = [];

function subscribeToDismissal(onChange: () => void): () => void {
  dismissListeners = [...dismissListeners, onChange];
  return () => {
    dismissListeners = dismissListeners.filter((listener) => listener !== onChange);
  };
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // A browser with site data blocked simply gets the panel every visit.
    return false;
  }
}

function dismissPanel(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Nothing to persist to; the panel still goes away for this page view.
  }
  for (const listener of dismissListeners) listener();
}

type Step = {
  title: string;
  hint: string;
  done: boolean;
  /** The way to do it, shown only while it is undone. */
  action: ReactNode;
};

function StepRow({ index, step }: { index: number; step: Step }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 md:border-l md:border-border md:pl-4 md:first:border-l-0 md:first:pl-0">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
          step.done
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-border text-muted-foreground",
        )}
      >
        {step.done ? <CheckIcon className="size-3" /> : index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", step.done && "text-muted-foreground")}>
          {step.title}
          <span className="sr-only">{step.done ? " — done" : " — still to do"}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{step.hint}</p>
        {step.done ? null : <div className="mt-2">{step.action}</div>}
      </div>
    </li>
  );
}

export function GettingStarted() {
  const connections = useQuery(api.connections.list);
  const workflows = useQuery(api.workflows.list);
  const usage = useQuery(api.usage.current, {});

  const dismissed = useSyncExternalStore(subscribeToDismissal, readDismissed, () => false);

  const loading = connections === undefined || workflows === undefined || usage === undefined;
  if (loading) {
    return <Skeleton className="h-28 w-full rounded-xl" aria-label="Loading your first steps" />;
  }

  const hasConnection = connections.length > 0;
  const hasWorkflow = workflows.length > 0;
  const hasRun = usage.runs > 0;

  // Nothing left to say, or the reader has said they do not want it.
  if (dismissed || (hasConnection && hasWorkflow && hasRun)) return null;

  // The newest workflow is the one the reader most likely just made, so "Run it" opens that one.
  const newest = workflows[0];

  const steps: Step[] = [
    {
      title: "Add a connection",
      hint: "Bring your own API key or bot token. It is encrypted before it is stored.",
      done: hasConnection,
      action: (
        <Link
          href="/connections"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <PlugZapIcon />
          Add a connection
        </Link>
      ),
    },
    {
      title: "Create a workflow",
      hint: "Draw a trigger and a few actions, or start from a template.",
      done: hasWorkflow,
      action: (
        <NewWorkflowDialog
          defaultTab="template"
          trigger={
            <Button variant="outline" size="sm">
              Start from a template
            </Button>
          }
        />
      ),
    },
    {
      title: "Run it",
      hint: "Press Run on the canvas and watch each node light up as it goes.",
      done: hasRun,
      action: newest ? (
        <Link
          href={`/w/${newest._id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <PlayIcon />
          Open {newest.name}
        </Link>
      ) : (
        <p className="text-xs text-muted-foreground">Create a workflow first.</p>
      ),
    },
  ];

  return (
    <section
      aria-label="Getting started"
      className="relative rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          Get your first run finished
          <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">
            Three steps, then this panel goes away on its own.
          </span>
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide the getting started panel"
          onClick={dismissPanel}
        >
          <XIcon />
        </Button>
      </div>

      <ol className="mt-4 grid gap-5 md:grid-cols-3 md:gap-4">
        {steps.map((step, index) => (
          <StepRow key={step.title} index={index} step={step} />
        ))}
      </ol>
    </section>
  );
}
