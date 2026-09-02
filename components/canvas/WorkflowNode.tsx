"use client";

import { Fragment } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/nodes/categories";
import type { AnyNodeDef } from "@/nodes/define";
import { NODES } from "@/nodes/registry";

import type { WorkflowNodeType } from "./graph-io";
import { NodeIcon } from "./node-icon";
import { StatusRing } from "./StatusRing";

const HANDLE_CLASS = "size-2 border border-background bg-muted-foreground";

/**
 * Source handle ids for a node. `handles()` is a user-supplied function of a half-finished
 * config (Condition and Switch grow one handle per branch in Phase 3), so a definition that
 * throws must not take the whole canvas down with it.
 */
function sourceHandles(definition: AnyNodeDef | undefined, inputs: Record<string, unknown>): string[] {
  if (!definition?.handles) return ["out"];
  try {
    const handles = definition.handles(inputs);
    return handles.length > 0 ? handles : ["out"];
  } catch {
    return ["out"];
  }
}

/**
 * Every node on the canvas is this component — the registry decides the icon, the category and
 * how many source handles it has. `data.status` is idle until Phase 2 feeds it live run state.
 */
export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeType>) {
  const definition = NODES[data.nodeType];
  const handles = sourceHandles(definition, data.inputs);

  return (
    <div
      className={cn(
        "relative min-w-44 rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow",
        selected && "ring-2 ring-primary",
      )}
    >
      {definition?.category !== "trigger" && (
        <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      )}

      <div className="flex items-center gap-2">
        <StatusRing status={data.status} />
        <NodeIcon name={definition?.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{data.label}</span>
        <Badge variant="outline" className="ml-auto shrink-0">
          {definition ? categoryLabel(definition.category) : "Unknown"}
        </Badge>
      </div>

      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{data.nodeType}</p>

      {handles.map((handle, index) => {
        const top = `${((index + 1) / (handles.length + 1)) * 100}%`;
        return (
          <Fragment key={handle}>
            <Handle
              id={handle}
              type="source"
              position={Position.Right}
              style={{ top }}
              className={HANDLE_CLASS}
            />
            {handles.length > 1 && (
              <span
                aria-hidden
                style={{ top }}
                className="pointer-events-none absolute right-1.5 -translate-y-1/2 text-[10px] leading-none text-muted-foreground"
              >
                {handle}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
