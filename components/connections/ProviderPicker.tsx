"use client";

import { useId, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";

import { NodeIcon } from "@/components/canvas/node-icon";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ConnectorCatalogueEntry } from "@/connectors/registry";
import { cn } from "@/lib/utils";

type ConnectorCategory = ConnectorCatalogueEntry["category"];

/** Rendering order matches `connectorCatalogue()`'s own sort, so the groups come out in this order. */
const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  ai: "AI",
  chat: "Chat",
  data: "Data",
  email: "Email",
  payments: "Payments",
};

export type ProviderPickerProps = {
  /** Already filtered by the caller when a node only accepts some providers. */
  entries: readonly ConnectorCatalogueEntry[];
  onSelect: (provider: string) => void;
};

/** Groups in catalogue order; a category with no matches is left out entirely. */
function groupByCategory(
  entries: readonly ConnectorCatalogueEntry[],
): { category: ConnectorCategory; entries: ConnectorCatalogueEntry[] }[] {
  const groups: { category: ConnectorCategory; entries: ConnectorCatalogueEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.category === entry.category) last.entries.push(entry);
    else groups.push({ category: entry.category, entries: [entry] });
  }
  return groups;
}

/**
 * Step one of "Add connection": which app are we connecting? The list is the connector catalogue,
 * which is data only (`connectors/registry.ts`) — no `test()` runs here and nothing is fetched.
 *
 * Connectors the plan does not cover are shown rather than hidden: dimmed, with a "Pro" badge, so
 * the upgrade is discoverable. Picking one still works; the form then explains the wall instead of
 * firing a request that `/api/connections` would refuse anyway.
 */
export function ProviderPicker({ entries, onSelect }: ProviderPickerProps) {
  const searchId = useId();
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = needle
      ? entries.filter(
          (entry) =>
            entry.name.toLowerCase().includes(needle) ||
            entry.provider.toLowerCase().includes(needle),
        )
      : entries;
    return groupByCategory(matched);
  }, [entries, search]);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={searchId}
          value={search}
          autoFocus
          placeholder="Search apps…"
          aria-label="Search apps"
          className="pl-8"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {/* A fixed 288px list wastes two thirds of a phone screen inside a full-screen dialog. */}
      <ScrollArea className="h-72 max-sm:h-[55dvh]">
        {groups.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">No app matches “{search.trim()}”.</p>
        ) : (
          <div className="grid gap-3 pr-2">
            {groups.map((group) => (
              <div key={group.category} className="grid gap-1">
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  {CATEGORY_LABEL[group.category]}
                </p>
                {group.entries.map((entry) => (
                  <button
                    key={entry.provider}
                    type="button"
                    onClick={() => onSelect(entry.provider)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
                      !entry.allowed && "opacity-60",
                    )}
                  >
                    <NodeIcon name={entry.icon} className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {!entry.allowed && (
                      <Badge variant="outline" className="shrink-0">
                        Pro
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
