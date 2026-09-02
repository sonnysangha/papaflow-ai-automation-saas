"use client";

import { Fragment } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/nodes/categories";
import { NODES } from "@/nodes/registry";

import { sourceHandles, type WorkflowNodeType } from "./graph-io";
import { NodeIcon } from "./node-icon";
import { StatusRing } from "./StatusRing";

const HANDLE_CLASS = "size-2 border border-background bg-muted-foreground";

/**
 * Every node on the canvas is this component — the registry decides the icon, the category and
 * how many source handles it has. `data.status` is idle until Phase 2 feeds it live run state.
 */
export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeType>) {
  const definition = NODES[data.nodeType];
  const handles = sourceHandles(data.nodeType, data.inputs);

  return (
    <div
      className={cn(
        "relative min-w-44 rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow",
        selected && "ring-2 ring-primary",
        // A node the run never reached: the same quiet grey as its status dot, drawn as a dashed
        // outline so "this branch did not happen" reads at a glance next to a solid neighbour.
        data.status === "skipped" &&
          "outline-2 outline-offset-2 outline-dashed outline-muted-foreground/40",
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

      {/* The key, not the node type: this is the name templates address the node by
          (`{{ http_request_1.body }}`), so it has to be readable without opening the panel. */}
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={data.nodeType}>
        {data.key || data.nodeType}
      </p>

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
