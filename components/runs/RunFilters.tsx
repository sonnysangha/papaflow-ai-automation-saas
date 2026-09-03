"use client";

import { SearchIcon, XIcon } from "lucide-react";

import { RunStatusDot, RUN_STATUS_TONE, type RunStatus } from "@/components/shared/status";
import { TRIGGER_LABEL, triggerKind } from "@/components/shared/trigger";
import { TRIGGER_ICON } from "@/components/shared/TriggerChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  ANY,
  isFiltered,
  NO_FILTERS,
  STATUS_FILTERS,
  type RunFilters,
} from "./run-filters";

/**
 * The row between the strip and the table: status chips first, because "show me the failures" is
 * the question this page exists to answer, then the two dropdowns and a search box.
 *
 * A chip nobody can use is not drawn — a status with no runs on the page would filter to an empty
 * table — and the counts are on the chips themselves, so the shape of the list is readable before
 * you click anything.
 */

function StatusChip({
  status,
  count,
  selected,
  onSelect,
}: {
  /** A run status, or `all`. */
  status: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = status === ANY ? "All" : RUN_STATUS_TONE[status as RunStatus].label;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-border bg-muted text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {status === ANY ? null : <RunStatusDot status={status} className="size-1.5" title={label} />}
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

export function RunFiltersRow({
  filters,
  onChange,
  counts,
  triggers,
  workflows,
}: {
  filters: RunFilters;
  onChange: (next: RunFilters) => void;
  /** `statusCounts()` over the loaded runs: which chips to draw, and what each one says. */
  counts: Record<string, number>;
  /** The `trigger.type` values present on the page. */
  triggers: readonly string[];
  /** Every workflow in the organisation. Only the org-wide page has a workflow to choose. */
  workflows?: readonly { id: string; name: string }[];
}) {
  const shown = STATUS_FILTERS.filter((status) => (counts[status] ?? 0) > 0);
  const active = isFiltered(filters);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
        <StatusChip
          status={ANY}
          count={counts[ANY] ?? 0}
          selected={filters.status === ANY}
          onSelect={() => onChange({ ...filters, status: ANY })}
        />
        {shown.map((status) => (
          <StatusChip
            key={status}
            status={status}
            count={counts[status] ?? 0}
            selected={filters.status === status}
            onSelect={() => onChange({ ...filters, status })}
          />
        ))}
      </div>

      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        {workflows && workflows.length > 0 ? (
          <Select
            value={filters.workflow}
            onValueChange={(next) => {
              if (typeof next === "string") onChange({ ...filters, workflow: next });
            }}
          >
            <SelectTrigger size="sm" className="max-w-52 min-w-0" aria-label="Filter by workflow">
              <SelectValue>
                {(current: unknown) => (
                  <span className="truncate">
                    {current === ANY
                      ? "All workflows"
                      : (workflows.find((workflow) => workflow.id === current)?.name ?? "Workflow")}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All workflows</SelectItem>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  <span className="truncate">{workflow.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {triggers.length > 1 ? (
          <Select
            value={filters.trigger}
            onValueChange={(next) => {
              if (typeof next === "string") onChange({ ...filters, trigger: next });
            }}
          >
            <SelectTrigger size="sm" className="min-w-0" aria-label="Filter by trigger">
              <SelectValue>
                {(current: unknown) => (
                  <span className="truncate">
                    {current === ANY
                      ? "All triggers"
                      : TRIGGER_LABEL[triggerKind(current as string)]}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All triggers</SelectItem>
              {triggers.map((type) => {
                const Icon = TRIGGER_ICON[triggerKind(type)];
                return (
                  <SelectItem key={type} value={type}>
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    {TRIGGER_LABEL[triggerKind(type)]}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        ) : null}

        <div className="relative w-full min-w-40 sm:w-52">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={filters.text}
            aria-label="Search runs by workflow or error"
            placeholder="Search name or error…"
            className="h-7 pl-7 text-sm"
            onChange={(event) => onChange({ ...filters, text: event.target.value })}
          />
        </div>

        {active ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
            <XIcon />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
