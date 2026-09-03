"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { connectionNeed, type ConnectionLike } from "@/lib/connection-match";
import { featureLabel } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "@/nodes/categories";
import { nodeCatalogue, type CatalogueEntry } from "@/nodes/registry";

import { initialPaletteCollapsed } from "./editor-layout";
import { NODE_DRAG_MIME } from "./graph-io";
import { NodeIcon } from "./node-icon";
import { categoryTint } from "./node-summary";
import { NODE_SEARCH_INPUT_ID, hasModifier, isTypingTarget } from "./shortcuts";

const CARD = "block rounded-lg border border-border bg-card px-3 py-2 transition-colors";

/** The icon tile, name, badge and description — the same block whatever the card turns out to be. */
function NodeSummary({ entry, badge }: { entry: CatalogueEntry; badge: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      {/* The same tinted tile the node wears once it is on the canvas, so dragging one across is
          a move rather than a transformation. */}
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-md",
          categoryTint(entry.category),
        )}
      >
        <NodeIcon name={entry.icon} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
          {badge}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs break-words text-muted-foreground">
          {entry.description}
        </p>
      </div>
    </div>
  );
}

function NodeSidebarItem({
  entry,
  connections,
  onPick,
}: {
  entry: CatalogueEntry;
  /** The org's connections, or undefined while they load — nothing is dimmed until they land. */
  connections: readonly ConnectionLike[] | undefined;
  /** Tap-to-add: drops this node in the middle of the canvas. Undefined before the canvas mounts. */
  onPick?: (nodeType: string) => void;
}) {
  const soon = entry.version === "v2";
  const locked = !entry.allowed;
  const need = connectionNeed({
    credential: entry.credential,
    credentialOptional: entry.credentialOptional,
    connections,
  });

  // Two different walls, and the plan is the outer one: a Pro node the org cannot have is not made
  // draggable by connecting Slack to it. So the connection card is only offered when the plan is
  // not already the answer, and a node behind both says both — the Pro badge and its upgrade link,
  // with the missing connection as plain text (an anchor inside an anchor is not a thing).
  const wantsConnection = need !== null;
  const asLink = wantsConnection && !locked && !soon;
  const disabled = soon || locked || wantsConnection;

  const badge = locked ? (
    <Badge variant="secondary" className="shrink-0">
      Pro
    </Badge>
  ) : soon ? (
    <Badge variant="outline" className="shrink-0">
      Soon
    </Badge>
  ) : wantsConnection ? (
    <Badge variant="outline" className="shrink-0">
      Connect
    </Badge>
  ) : null;

  if (asLink && need) {
    // Not a node yet: it is a link to the thing that would make it one. `draggable={false}` is
    // explicit because an anchor drags its href by default, and dropping a URL on the canvas does
    // nothing but look broken.
    return (
      <Link
        href={need.href}
        draggable={false}
        title={`Connect ${need.label} before using this node`}
        className={cn(CARD, "hover:border-ring hover:bg-muted/50")}
      >
        <div className="opacity-50">
          <NodeSummary entry={entry} badge={badge} />
        </div>
        <span className="mt-1.5 inline-block text-xs underline underline-offset-4">
          Connect {need.label}
        </span>
      </Link>
    );
  }

  const body = (
    <>
      {/* Dimming the *contents* rather than the card leaves the upgrade link at full contrast —
          an `opacity` on the card would apply to its whole subtree, link included. */}
      <div className={cn(disabled && "opacity-50")}>
        <NodeSummary entry={entry} badge={badge} />
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

      {need && !asLink && (
        <p className="mt-1.5 text-xs break-words text-muted-foreground">
          Also needs {need.label} connected.
        </p>
      )}
    </>
  );

  // A usable node is a button as well as a drag source. Dragging is impossible with a finger on a
  // list that scrolls under it, and it is a slow way to do this with a mouse too — so one tap (or
  // click) drops the node in the middle of the canvas, and the drag stays for people who want to
  // choose where it lands. A blocked card keeps its `div`: it does nothing, and the one live thing
  // on it may be an anchor, which cannot live inside a button.
  if (!disabled && onPick) {
    return (
      <button
        type="button"
        draggable
        onDragStart={(event: DragEvent<HTMLButtonElement>) => {
          event.dataTransfer.setData(NODE_DRAG_MIME, entry.type);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => onPick(entry.type)}
        title="Tap to add it to the canvas, or drag it where you want it"
        className={cn(
          CARD,
          "w-full cursor-grab text-left hover:border-ring hover:bg-muted/50 active:cursor-grabbing",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {body}
      </button>
    );
  }

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
        CARD,
        disabled
          ? "cursor-not-allowed"
          : "cursor-grab hover:border-ring hover:bg-muted/50 active:cursor-grabbing",
      )}
    >
      {body}
    </div>
  );
}

/**
 * The node palette. Everything in the registry is listed; a node the organisation cannot use yet is
 * dimmed and undraggable rather than hidden, so the way past it is discoverable from where it is
 * met. There are two ways to be blocked and they read differently: the plan (a "Pro" badge and an
 * upgrade link) and a missing credential (a "Connect Slack" link straight to the form that adds
 * one), because dragging a Slack node onto the canvas only to find an empty connection dropdown is
 * a wasted trip.
 */
/**
 * "Is the palette folded away" as an external store, because that is what `localStorage` is: the
 * choice should survive a reload and follow the person across workflows, and
 * `useSyncExternalStore` gives the server and the first hydration pass `false` (open) before the
 * stored answer swaps in, so the markup never disagrees with itself.
 */
const COLLAPSE_KEY = "papaflow:nodes-collapsed";
const COLLAPSE_EVENT = "papaflow:nodes-collapsed";

function subscribeToCollapse(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSE_EVENT, onChange);
  };
}

/**
 * Folded or not, right now. With nothing stored this is a judgement about the window rather than
 * a preference (`initialPaletteCollapsed`): on a narrow screen the palette would leave no canvas,
 * so it starts out of the way and the first deliberate toggle stores an answer that always wins
 * from then on.
 */
function readCollapsed(): boolean {
  try {
    return initialPaletteCollapsed(window.innerWidth, window.localStorage.getItem(COLLAPSE_KEY));
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode or a full store: the palette still toggles for this page through the event.
  }
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}

/**
 * The palette's contents: a search box and every node in the registry, grouped by category.
 *
 * Rendered in two places and identical in both — the sidebar on a desktop, a bottom sheet on a
 * phone — so it owns the two subscriptions it needs (the plan, for what this org may use, and the
 * connections, for what is already wired up) and nothing about where it sits.
 *
 * @param onPick   Tap-to-add. Undefined until the canvas has mounted and reported it, in which case
 *                 the cards are drag sources only.
 * @param hint     The sentence under the search box, which differs by pointer.
 * @param trailing The control beside the search box — the fold-away button, on the sidebar only.
 */
export function NodePalette({
  onPick,
  hint,
  trailing,
}: {
  onPick?: (nodeType: string) => void;
  hint: string;
  trailing?: ReactNode;
}) {
  const plan = useQuery(api.plan.current, {});
  // The same list the config panel's connection picker reads, so the palette and the dropdown can
  // never disagree about whether this org has a usable Slack token.
  const connections = useQuery(api.connections.list);
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Above the scroll rather than inside it: on a phone the list is most of the screen, and a
          search box you have to scroll back up to reach is not a search box. */}
      <div className="shrink-0 border-b border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
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
              className="pr-8 pl-8"
            />
            {/* The binding, where the thing it operates is — not in a help menu. */}
            <kbd
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground md:block"
            >
              /
            </kbd>
          </div>
          {trailing}
        </div>
        <p id={`${NODE_SEARCH_INPUT_ID}-hint`} className="mt-2 text-xs text-muted-foreground">
          {hint}
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
              <h2 className="mb-2 px-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {group.label}
              </h2>
              <div className="space-y-2">
                {group.entries.map((entry) => (
                  <NodeSidebarItem
                    key={entry.type}
                    entry={entry}
                    connections={connections}
                    onPick={onPick}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The palette as the editor's left-hand column, folded or not.
 *
 * Desktop only: below `md` the column would leave no canvas at all, so `Editor` renders the
 * floating "Add node" button and `<NodePaletteSheet>` instead of this.
 */
export function NodeSidebar({ onPick }: { onPick?: (nodeType: string) => void }) {
  const collapsed = useSyncExternalStore(subscribeToCollapse, readCollapsed, () => false);
  // `/` from anywhere: focus the search — and if the palette is folded away, unfold it first and
  // focus once the input exists. A ref carries that intent across the re-render.
  const focusAfterExpand = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || hasModifier(event) || isTypingTarget(event.target)) return;
      event.preventDefault();
      if (readCollapsed()) {
        focusAfterExpand.current = true;
        writeCollapsed(false);
      } else {
        document.getElementById(NODE_SEARCH_INPUT_ID)?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!collapsed && focusAfterExpand.current) {
      focusAfterExpand.current = false;
      document.getElementById(NODE_SEARCH_INPUT_ID)?.focus();
    }
  }, [collapsed]);

  if (collapsed) {
    return (
      <aside
        aria-label="Nodes, collapsed"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-2"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Show nodes"
          title="Show nodes (/)"
          onClick={() => writeCollapsed(false)}
        >
          <PanelLeftOpenIcon className="size-4" />
        </Button>
        <span className="mt-1 text-[10px] font-medium tracking-wide text-muted-foreground [writing-mode:vertical-rl]">
          Nodes
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
      <NodePalette
        onPick={onPick}
        hint="Click a node to add it, or drag it where you want it. Press / to search from anywhere."
        trailing={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Hide nodes"
            title="Hide the node list"
            onClick={() => writeCollapsed(true)}
          >
            <PanelLeftCloseIcon className="size-4" />
          </Button>
        }
      />
    </aside>
  );
}

/**
 * The palette on a phone: the same list, in a sheet that comes up from the bottom.
 *
 * Three quarters of the screen rather than all of it, so the canvas the node is about to land on
 * stays visible behind it. Picking one closes the sheet — the node is on the canvas, and the next
 * thing anybody does is look at it.
 */
export function NodePaletteSheet({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (nodeType: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `data-[side=bottom]:` on purpose: the sheet's own base class is `data-[side=bottom]:h-auto`,
          and a plain `h-[75dvh]` does not conflict with it in tailwind-merge — both survive and the
          variant wins, which grows the sheet to the height of the whole node list. Matching the
          variant is what actually replaces it. */}
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-2xl p-0 data-[side=bottom]:h-[75dvh]"
      >
        <SheetHeader className="shrink-0 pb-2">
          <SheetTitle>Add a node</SheetTitle>
        </SheetHeader>
        <NodePalette
          hint="Tap a node to drop it in the middle of the canvas."
          onPick={(nodeType) => {
            onPick(nodeType);
            onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
