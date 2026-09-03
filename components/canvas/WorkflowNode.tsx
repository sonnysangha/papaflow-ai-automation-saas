"use client";

import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/nodes/categories";
import { NODES } from "@/nodes/registry";

import { handleDisplays, type WorkflowNodeType } from "./graph-io";
import { NodeIcon } from "./node-icon";
import { StatusRing, statusSummary } from "./StatusRing";

const HANDLE_CLASS = "size-2 border border-background bg-muted-foreground";

/** The narrowest a node may be dragged: two names and a badge need this much room. */
export const MIN_NODE_WIDTH = 200;
/** …and a branching node needs a column beside them, so it starts wider. */
export const MIN_BRANCHING_NODE_WIDTH = 260;

/**
 * The shortest a node with this many ways out may be dragged.
 *
 * A branch chip is a real row in a real column, not a label floating over the card, so the node's
 * height is what the branches are laid out in: five Switch cases cannot be squeezed into the height
 * of a two-line header without stacking on top of each other again.
 */
export function minNodeHeight(handleCount: number): number {
  return Math.max(72, 24 + handleCount * 26);
}

/**
 * Every node on the canvas is this component — the registry decides the icon, the category and
 * how many source handles it has. `data.status` and `data.durationMs` come from the latest run's
 * steps (`Editor` merges them in), and are the only things here that are not saved.
 *
 * A node carries two names on purpose: the label you gave it, and underneath it in mono the key
 * templates address it by (`{{ greet.text }}`). The pair repeats in the config panel and in the
 * runs drawer, so the name you read and the name you type are never a guess apart.
 *
 * The layout is two columns rather than one box with things drawn over its right edge. The header —
 * status, icon, title — owns the top line; the key and the category badge share the second; and a
 * branching node gets a column of its own for the words on its arrows, one row per handle, with the
 * handle sitting on the card's edge at that row's middle. Nothing overlaps because nothing is
 * positioned over anything: it is a flex row, and adding a branch makes the node taller rather than
 * busier.
 */
export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeType>) {
  const definition = NODES[data.nodeType];
  const handles = handleDisplays(data.nodeType, data.inputs);
  const summary = statusSummary(data.status, data.durationMs);
  const branching = handles.length > 1;

  return (
    <>
      {/* Drag any edge or corner to resize; the controls only exist while the node is selected, so
          a canvas at rest is not eight handles per node. The size is saved with the graph
          (`toStoredGraph`), which is why a wide node stays wide after a reload. */}
      <NodeResizer
        isVisible={selected}
        color="var(--primary)"
        minWidth={branching ? MIN_BRANCHING_NODE_WIDTH : MIN_NODE_WIDTH}
        minHeight={minNodeHeight(handles.length)}
      />

      {/* The delay comes from the `TooltipProvider` `Canvas` wraps the flow in: a canvas is a lot of
          hover targets, and firing every one of them while panning would be a light show. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              className={cn(
                // `h-full` so a resized node's card fills the box React Flow sized for it rather
                // than sitting content-height inside its own resize controls.
                "relative flex h-full items-stretch rounded-lg border border-border bg-card text-left shadow-sm transition-shadow",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                branching ? "min-w-[260px]" : "min-w-[200px]",
                selected && "ring-2 ring-primary",
                // A node the run never reached: the same quiet grey as its status dot, drawn as a
                // dashed outline so "this branch did not happen" reads at a glance next to a solid
                // neighbour.
                data.status === "skipped" &&
                  "outline-2 outline-offset-2 outline-dashed outline-muted-foreground/40",
              )}
            />
          }
        >
          {definition?.category !== "trigger" ? (
            <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3">
            <div className="flex min-w-0 items-center gap-2">
              {/* The whole node names its status in the tooltip, so the dot must not repeat it. */}
              <StatusRing status={data.status} labelled={false} />
              <NodeIcon name={definition?.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{data.label}</span>
            </div>

            {/* The key, not the node type: this is the name templates address the node by
                (`{{ http_request_1.body }}`), so it has to be readable without opening the panel.
                The badge moved down beside it, out of the title's way. */}
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {data.key || data.nodeType}
              </span>
              <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
                {definition ? categoryLabel(definition.category) : "Unknown"}
              </Badge>
            </div>
          </div>

          {branching ? (
            <div className="flex w-20 shrink-0 flex-col justify-around self-stretch border-l border-border py-1.5">
              {handles.map(({ handle, label }) => (
                // `relative`, so the handle's default `right: 0; top: 50%` puts the dot on the
                // card's edge at this row's middle — the words and the dot cannot drift apart.
                <div key={handle} className="relative flex min-h-5 items-center">
                  {/* The plain word, with the id the graph stores on hover. Hoverable rather than
                      `pointer-events-none`, so the title works; mousedown still bubbles to the
                      node, so dragging the node by its own label keeps working. */}
                  <span
                    title={`Arrow “${label}” — saved as ${handle}`}
                    className="min-w-0 flex-1 cursor-default truncate pr-2.5 pl-2 text-[11px] leading-4 text-muted-foreground"
                  >
                    {label}
                  </span>
                  <Handle id={handle} type="source" position={Position.Right} className={HANDLE_CLASS} />
                </div>
              ))}
            </div>
          ) : (
            <Handle
              id={handles[0]?.handle}
              type="source"
              position={Position.Right}
              className={HANDLE_CLASS}
            />
          )}
        </TooltipTrigger>

        <TooltipContent side="top" className="flex-col items-start gap-0.5">
          <span className="font-medium">{summary}</span>
          <span className="font-mono text-[11px]">{definition?.type ?? data.nodeType}</span>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
