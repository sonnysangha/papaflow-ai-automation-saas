"use client";

import { useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { featureLabel } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "@/nodes/categories";
import { nodeCatalogue, type CatalogueEntry } from "@/nodes/registry";

import { NODE_DRAG_MIME } from "./graph-io";
import { NodeIcon } from "./node-icon";
import { NODE_SEARCH_INPUT_ID } from "./shortcuts";

function NodeSidebarItem({ entry }: { entry: CatalogueEntry }) {
  const soon = entry.version === "v2";
  const locked = !entry.allowed;
  const disabled = soon || locked;

  return (
    <div
      draggable={!disabled}
      onDragStart={(event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData(NODE_DRAG_MIME, entry.type);
        event.dataTransfer.effectAllowed = "move";
      }}
      aria-disabled={disabled || undefined}
      title={disabled ? undefined : "Drag onto the canvas"}
      className={cn(
        "rounded-lg border border-border bg-background p-2.5 transition-colors",
        disabled
          ? "cursor-not-allowed"
          : "cursor-grab hover:border-ring hover:bg-muted active:cursor-grabbing",
      )}
    >
      {/* Dimming the *contents* rather than the card leaves the upgrade link at full contrast —
          an `opacity` on the card would apply to its whole subtree, link included. */}
      <div className={cn(disabled && "opacity-50")}>
        <div className="flex items-center gap-2">
          <NodeIcon name={entry.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{entry.name}</span>
          {locked ? (
            <Badge variant="secondary" className="ml-auto shrink-0">
              Pro
            </Badge>
          ) : soon ? (
            <Badge variant="outline" className="ml-auto shrink-0">
              Soon
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{entry.description}</p>
      </div>

      {locked && entry.requiresFeature && (
        // The card itself is undraggable; the link is the one live thing on it, so the upgrade is
        // reachable from where the wall is met rather than only from settings.
        <Link
          href="/settings/billing"
          className="mt-1.5 inline-block cursor-pointer text-xs underline underline-offset-4"
        >
          Upgrade for {featureLabel(entry.requiresFeature).toLowerCase()}
        </Link>
      )}
    </div>
  );
}

/**
 * The node palette. Everything in the registry is listed; nodes the organisation's plan does
 * not cover are dimmed and undraggable rather than hidden, so the upgrade is discoverable.
 */
export function NodeSidebar() {
  const plan = useQuery(api.plan.current, {});
  const [search, setSearch] = useState("");

  const features = plan?.features;
  const catalogue = useMemo(() => nodeCatalogue(features ?? []), [features]);

  const query = search.trim().toLowerCase();
  const matches = query
    ? catalogue.filter((entry) =>
        `${entry.name} ${entry.description} ${entry.type}`.toLowerCase().includes(query),
      )
    : catalogue;

  const groups = CATEGORIES.map((category) => ({
    ...category,
    entries: matches.filter((entry) => entry.category === category.id),
  })).filter((group) => group.entries.length > 0);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={NODE_SEARCH_INPUT_ID}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              // Escape gets you out of the search and back to the canvas, where Escape then means
              // "close the settings panel".
              if (event.key === "Escape") event.currentTarget.blur();
            }}
            placeholder="Search nodes"
            aria-label="Search nodes"
            aria-describedby={`${NODE_SEARCH_INPUT_ID}-hint`}
            className="pl-8 pr-8"
          />
          {/* The binding, where the thing it operates is — not in a help menu. */}
          <kbd
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground"
          >
            /
          </kbd>
        </div>
        <p id={`${NODE_SEARCH_INPUT_ID}-hint`} className="mt-2 text-xs text-muted-foreground">
          Drag a node onto the canvas. Press / to search from anywhere.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {plan === undefined ? (
          <div className="space-y-2">
            {["a", "b", "c", "d"].map((key) => (
              <Skeleton key={key} className="h-14 w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-0.5 text-sm text-muted-foreground">No nodes match “{search.trim()}”.</p>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="mb-4 last:mb-0">
              <h2 className="mb-2 px-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </h2>
              <div className="space-y-2">
                {group.entries.map((entry) => (
                  <NodeSidebarItem key={entry.type} entry={entry} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
