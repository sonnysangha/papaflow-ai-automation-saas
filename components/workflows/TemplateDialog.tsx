"use client";

import { Fragment, useId, useMemo, useState, type ReactElement } from "react";
import { ChevronRightIcon, LayoutTemplateIcon, PlugZapIcon, SearchIcon } from "lucide-react";

import { NodeIcon } from "@/components/canvas/node-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { featureLabel } from "@/lib/plans";
import {
  credentialName,
  templateSetup,
  WORKFLOW_TEMPLATES,
  type TemplateGraph,
  type WorkflowTemplate,
} from "@/lib/templates";
import { cn } from "@/lib/utils";
import { NODES } from "@/nodes/registry";

import {
  ALL_CATEGORIES,
  filterTemplates,
  flowStrip,
  templateCategories,
} from "./template-flow";

/**
 * The starter-template picker, used from three places: the "New workflow" dialog, where picking one
 * creates a workflow; the empty canvas, where it drops the graph onto the workflow you already
 * have; and the empty workflow list, which shows the shelf outright rather than behind a button.
 * Same list, same cards — only what happens on the click differs.
 */

/** How many hops of a template's main path a card draws before it counts the rest. */
const FLOW_LIMIT = 6;

/** The nodes of a template as a path: trigger → action → action, in the order they run. */
function TemplateFlow({ graph }: { graph: TemplateGraph }) {
  const { steps, more } = flowStrip(graph, FLOW_LIMIT);
  if (steps.length === 0) return null;

  return (
    // Its own scroller: a long path may not fit a card, and the page must never be the thing that
    // scrolls sideways.
    <div className="-mx-0.5 flex items-center gap-1 overflow-x-auto px-0.5 pb-0.5">
      {steps.map((step, index) => (
        <Fragment key={`${step.nodeType}-${index}`}>
          {index > 0 ? (
            <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
          ) : null}
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs">
            <NodeIcon
              name={NODES[step.nodeType]?.icon}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="max-w-28 truncate">{step.label}</span>
          </span>
        </Fragment>
      ))}
      {more > 0 ? (
        <span className="shrink-0 pl-1 text-xs text-muted-foreground">+{more} more</span>
      ) : null}
    </div>
  );
}

/** "Needs Telegram" — one chip per connection this template will ask you for. */
function SetupChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 text-xs text-muted-foreground">
      <PlugZapIcon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

function TemplateCard({
  template,
  pending,
  disabled,
  onPick,
}: {
  template: WorkflowTemplate;
  pending: boolean;
  disabled: boolean;
  onPick: (template: WorkflowTemplate) => void;
}) {
  // "an AI provider" and "Telegram" rather than "ai" and "telegram": the card is read before the
  // template is picked, so it has to say what you will be asked for in the words you would use.
  const needs = [...new Set(templateSetup(template.graph).map((step) => credentialName(step.credential)))];

  function pick() {
    if (!disabled) onPick(template);
  }

  return (
    // The card is clickable as a convenience; the button inside it is the real control, so
    // keyboard users get one focus stop that does exactly what the whole card does.
    <div
      onClick={pick}
      className={cn(
        "group flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors",
        "hover:border-ring hover:bg-muted/40 has-[button:focus-visible]:border-ring",
        disabled && "cursor-not-allowed opacity-60",
        pending && "border-ring bg-muted/40",
      )}
    >
      <div className="min-w-0">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{template.category}</p>
        <div className="mt-1 flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{template.name}</p>
          {template.requiresFeature ? (
            <Badge variant="secondary" className="shrink-0">
              {featureLabel(template.requiresFeature)}
            </Badge>
          ) : null}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{template.description}</p>

      <TemplateFlow graph={template.graph} />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {needs.length > 0 ? (
            needs.map((need) => <SetupChip key={need}>Needs {need}</SetupChip>)
          ) : (
            <span className="text-xs text-muted-foreground">Runs as soon as you add it</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={(event) => {
            // The card behind it would otherwise pick the same template twice.
            event.stopPropagation();
            pick();
          }}
        >
          {pending ? "Adding…" : "Use template"}
        </Button>
      </div>
    </div>
  );
}

export type TemplateGalleryProps = {
  onPick: (template: WorkflowTemplate) => void;
  /** The template currently being created, so its card can say so and the rest can wait. */
  pendingId?: string | null;
  /** Sizes the gallery's own scroll area — a dialog caps it, the empty state lets it run. */
  className?: string;
};

/** The starter workflows as cards, with a search box and the categories above them. */
export function TemplateGallery({ onPick, pendingId, className }: TemplateGalleryProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  const categories = useMemo(() => templateCategories(WORKFLOW_TEMPLATES), []);
  const shown = useMemo(
    () => filterTemplates(WORKFLOW_TEMPLATES, { query, category }),
    [query, category],
  );

  const busy = pendingId !== null && pendingId !== undefined;

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex flex-col gap-2">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
            className="pl-8"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Template categories">
          {categories.map((entry) => {
            const active = entry.value === category;
            return (
              <Button
                key={entry.value}
                type="button"
                size="xs"
                variant={active ? "secondary" : "ghost"}
                aria-pressed={active}
                onClick={() => setCategory(entry.value)}
              >
                {entry.label}
                <span className="text-muted-foreground tabular-nums">{entry.count}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-6">
          <p className="text-sm font-medium">No templates match</p>
          <p className="text-sm text-muted-foreground">
            Try a shorter search, or start from a blank canvas and draw it yourself.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setCategory(ALL_CATEGORIES);
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                pending={pendingId === template.id}
                disabled={busy}
                onPick={onPick}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export type TemplateDialogProps = {
  trigger: ReactElement;
  title?: string;
  description?: string;
  onPick: (template: WorkflowTemplate) => void;
};

/**
 * The gallery in a dialog of its own, for the empty canvas. The workflow already exists there, so
 * picking a template is an edit rather than a create and the dialog closes as soon as one lands.
 */
export function TemplateDialog({ trigger, title, description, onPick }: TemplateDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplateIcon aria-hidden className="size-4 text-muted-foreground" />
            {title ?? "Start from a template"}
          </DialogTitle>
          <DialogDescription>
            {description ?? "Each one is a working graph you can edit. Nothing is locked in."}
          </DialogDescription>
        </DialogHeader>

        <TemplateGallery
          className="max-h-[60vh]"
          onPick={(template) => {
            onPick(template);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
