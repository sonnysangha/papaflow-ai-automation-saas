"use client";

import { useRef, useState } from "react";
import type { Edge } from "@xyflow/react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { outputPaths, type OutputPath } from "@/nodes/paths";
import { NODES } from "@/nodes/registry";
import { loopFor } from "@/workflows/graph";

import { upstreamNodeIds, type WorkflowNodeType } from "./graph-io";
import { pathsFromValue } from "./paths-from-value";

/** One insertable template path, already prefixed with its root (`http_request_1.body`). */
export type VariableEntry = {
  path: string;
  type: string;
  /** True when the path came from the last run's output rather than the node's output schema. */
  observed: boolean;
};

export type VariableGroup = {
  /** Root of every entry in the group — a node key, or `trigger`. */
  key: string;
  label: string;
  entries: VariableEntry[];
};

/** Schema paths first, then anything the last run showed that the schema did not describe. */
function mergePaths(schema: OutputPath[], observed: OutputPath[]): VariableEntry[] {
  const entries: VariableEntry[] = schema.map((path) => ({ ...path, observed: false }));
  const seen = new Set(entries.map((entry) => entry.path));
  for (const path of observed) {
    if (seen.has(path.path)) continue;
    seen.add(path.path);
    entries.push({ ...path, observed: true });
  }
  return entries;
}

/** A definition's `outputs` may be any zod schema; a conversion failure must not blank the list. */
function schemaPaths(nodeType: string): OutputPath[] {
  const definition = NODES[nodeType];
  if (!definition) return [];
  try {
    return outputPaths(definition.outputs);
  } catch {
    return [];
  }
}

function prefixed(root: string, paths: VariableEntry[]): VariableEntry[] {
  return paths.map((entry) => ({ ...entry, path: `${root}.${entry.path}` }));
}

/**
 * What the picker offers for one node: every ancestor's output, nearest first, plus the reserved
 * roots — `trigger` always, and `$item` when this node sits on a Loop body. Each group leads with
 * the node itself (`{{ key }}` is the whole output) and then its paths — the ones its `outputs`
 * schema declares, followed by the ones the latest run showed.
 */
export function buildVariableGroups({
  nodeId,
  nodes,
  edges,
  runOutputs,
}: {
  nodeId: string;
  nodes: readonly WorkflowNodeType[];
  edges: readonly Edge[];
  /** Latest run output per node id. */
  runOutputs: Record<string, unknown>;
}): VariableGroup[] {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const groups: VariableGroup[] = [];

  for (const id of upstreamNodeIds(edges, nodeId)) {
    const upstream = byId.get(id);
    if (!upstream || !upstream.data.key) continue;
    const paths = mergePaths(schemaPaths(upstream.data.nodeType), pathsFromValue(runOutputs[id]));
    groups.push({
      key: upstream.data.key,
      label: `${upstream.data.label} · ${upstream.data.key}`,
      entries: [
        { path: upstream.data.key, type: "object", observed: false },
        ...prefixed(upstream.data.key, paths),
      ],
    });
  }

  // `$item` is the other reserved root, and unlike `trigger` it only exists somewhere: on the body
  // of a Loop, where every node runs once per element. `loopFor` is the same pure helper the
  // orchestrator uses to decide what a body is, so the picker offers `{{ $item }}` exactly where
  // the run will resolve it.
  // No sub-paths: the item is whatever the loop's list holds, and no step row records it — the
  // author knows its shape, and `{{ $item.name }}` can be typed on from here.
  if (loopFor({ nodes: Object.fromEntries(byId), edges }, nodeId)) {
    groups.push({
      key: "$item",
      label: "Loop item",
      entries: [{ path: "$item", type: "any", observed: false }],
    });
  }

  // `trigger` resolves to the trigger's payload in every node's context, whether or not the
  // trigger is an ancestor of this node, so the group is listed even on a disconnected node.
  const trigger = nodes.find((entry) => NODES[entry.data.nodeType]?.category === "trigger");
  if (trigger) {
    groups.push({
      key: "trigger",
      label: "Trigger payload",
      entries: [
        { path: "trigger", type: "object", observed: false },
        ...prefixed(
          "trigger",
          pathsFromValue(runOutputs[trigger.id]).map((path) => ({ ...path, observed: true })),
        ),
      ],
    });
  }

  return groups;
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
              <CommandGroup key={group.key} heading={group.label}>
                {group.entries.map((entry) => (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    onSelect={() => {
                      onInsert(`{{ ${entry.path} }}`);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate font-mono text-xs">{entry.path}</span>
                    <span
                      className={cn(
                        "ml-auto shrink-0 text-[10px]",
                        entry.observed ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                      )}
                      title={entry.observed ? "Seen in the last run" : "From the node's output schema"}
                    >
                      {entry.type}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
