"use client";

import { useState, type ReactElement } from "react";
import { ChevronRightIcon, PlugZapIcon } from "lucide-react";

import { NodeIcon } from "@/components/canvas/node-icon";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

/**
 * The starter-template picker, used from two places: the "New workflow" dialog, where picking one
 * creates a workflow, and the empty canvas, where it drops the graph onto the workflow you already
 * have. Both are the same list and the same cards — only what happens on the click differs.
 */

/** How many nodes a card previews before it stops and counts the rest. */
const PREVIEW_LIMIT = 4;

type PreviewNode = { key: string; label: string; icon?: string };

function previewNodes(graph: TemplateGraph): { shown: PreviewNode[]; more: number } {
  const shown = graph.nodes.slice(0, PREVIEW_LIMIT).map((entry) => ({
    key: entry.data.key,
    label: entry.data.label,
    icon: NODES[entry.data.nodeType]?.icon,
  }));
  return { shown, more: Math.max(0, graph.nodes.length - shown.length) };
}

/** The nodes of a template, as a row of chips — enough to recognise the shape without opening it. */
function TemplatePreview({ graph }: { graph: TemplateGraph }) {
  const { shown, more } = previewNodes(graph);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((entry, index) => (
        <span key={entry.key} className="flex items-center gap-1">
          {index > 0 ? (
            <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
          ) : null}
          <span className="flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-xs">
            <NodeIcon name={entry.icon} className="size-3 shrink-0 text-muted-foreground" />
            <span className="max-w-28 truncate">{entry.label}</span>
          </span>
        </span>
      ))}
      {more > 0 ? <span className="text-xs text-muted-foreground">+{more} more</span> : null}
    </div>
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
  const setup = templateSetup(template.graph);
  // "an AI provider" and "Telegram" rather than "ai" and "telegram": the card is read before the
  // template is picked, so it has to say what you will be asked for in the words you would use.
  const needs = [...new Set(setup.map((step) => credentialName(step.credential)))];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(template)}
      className={cn(
        "group flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 text-left transition-colors",
        "hover:border-ring hover:bg-muted/40",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        pending && "border-ring bg-muted/40",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {template.category}
          </p>
          <p className="mt-0.5 text-sm font-medium">{template.name}</p>
        </div>
        {template.requiresFeature ? (
          <Badge variant="secondary" className="shrink-0">
            {featureLabel(template.requiresFeature)}
          </Badge>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">{template.description}</p>

      <TemplatePreview graph={template.graph} />

      {needs.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PlugZapIcon aria-hidden className="size-3.5 shrink-0" />
          Needs {needs.join(" and ")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Runs as soon as you add it.</p>
      )}

      <span
        aria-hidden
        className={cn(
          "text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground",
        )}
      >
        {pending ? "Adding…" : "Use this template →"}
      </span>
    </button>
  );
}

export type TemplateGalleryProps = {
  onPick: (template: WorkflowTemplate) => void;
  /** The template currently being created, so its card can say so and the rest can wait. */
  pendingId?: string | null;
};

/** The five starter workflows as cards. Clicking one is the whole interaction. */
export function TemplateGallery({ onPick, pendingId }: TemplateGalleryProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {WORKFLOW_TEMPLATES.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          pending={pendingId === template.id}
          disabled={pendingId !== null && pendingId !== undefined}
          onPick={onPick}
        />
      ))}
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title ?? "Start from a template"}</DialogTitle>
          <DialogDescription>
            {description ??
              "Each one is a working graph you can edit. Nothing is locked in."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          <TemplateGallery
            onPick={(template) => {
              onPick(template);
              setOpen(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
