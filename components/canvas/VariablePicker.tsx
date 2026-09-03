"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { variableEntryLabel, type VariableEntry, type VariableGroup } from "./variables";

/**
 * One offered path: what to type, what type it is, and — once the workflow has run — what was
 * actually sitting there. The preview is the point of the row: `body.items[0].id` means nothing
 * until you can see `ord_18f2` next to it.
 */
function VariableRow({ entry, onSelect }: { entry: VariableEntry; onSelect: () => void }) {
  return (
    <CommandItem
      value={entry.path}
      // Searching for a value you can see in the list has to find its path.
      keywords={entry.preview ? [entry.preview] : undefined}
      aria-label={variableEntryLabel(entry)}
      className="flex-col items-start gap-0.5 py-1.5"
      onSelect={onSelect}
    >
      <div className="flex w-full min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
          {entry.path}
        </span>
        {entry.observed ? (
          <span
            className="shrink-0 rounded-sm border border-border px-1 text-[10px] leading-4 text-muted-foreground"
            title="Only in the last run's data — the node's schema does not declare it"
          >
            from last run
          </span>
        ) : null}
        {/* A `command-shortcut` slot is also what tells the item's tick to stay out of the way:
            nothing here is ever "checked", and in a two-line row it would leave a gap. */}
        <CommandShortcut className="shrink-0 text-[10px] tracking-normal">
          {entry.type}
        </CommandShortcut>
      </div>
      {entry.preview ? (
        // One line, always: `previewOf` already caps the length, but a 40-character token still has
        // to be cut rather than allowed to widen the 320px popover.
        <span
          className="w-full min-w-0 truncate font-mono text-[11px] text-muted-foreground"
          title={entry.preview}
        >
          {entry.preview}
        </span>
      ) : null}
    </CommandItem>
  );
}

/**
 * The `{}` button next to every template field. Selecting a path inserts `{{ path }}` where the
 * caret was and hands focus back to the field, so a template can be typed around.
 */
export function VariablePicker({
  groups,
  onInsert,
  finalFocus,
  className,
}: {
  groups: VariableGroup[];
  onInsert: (template: string) => void;
  /** The field to focus when the popover closes — its caret is where the insert landed. */
  finalFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Insert a variable"
            aria-label="Insert a variable"
            className={cn("shrink-0 font-mono text-xs", className)}
          >
            {"{}"}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-80 p-0"
        initialFocus={searchRef}
        finalFocus={finalFocus}
      >
        <Command>
          <CommandInput ref={searchRef} placeholder="Search variables" />
          <CommandList>
            <CommandEmpty className="text-muted-foreground">
              No variables here yet — connect this node to one above it.
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.key}
                value={group.key}
                heading={
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    {group.ran ? (
                      <span className="shrink-0 font-normal text-muted-foreground/70">
                        · last run
                      </span>
                    ) : null}
                  </span>
                }
              >
                {group.entries.map((entry) => (
                  <VariableRow
                    key={entry.path}
                    entry={entry}
                    onSelect={() => {
                      onInsert(`{{ ${entry.path} }}`);
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
