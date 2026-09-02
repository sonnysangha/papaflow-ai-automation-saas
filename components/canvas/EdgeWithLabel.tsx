"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

import { cn } from "@/lib/utils";

/**
 * A wire that says which way it goes.
 *
 * Only nodes that branch declare more than one source handle — Condition (`true`/`false`), Switch
 * (one per case), Loop (`each`/`done`), Approval (`approved`/`rejected`) — and on those the handle
 * id *is* the answer the node gave. Reading it off the canvas is the difference between "these two
 * wires leave the same node" and "this one runs when the answer was no", so the id is drawn on the
 * wire rather than left to a hover.
 *
 * Every edge on a non-branching node stays the default bezier: a label reading "out" would be
 * noise, and `Canvas` only assigns this type where there is something to say.
 */

/** The edge type id registered in `Canvas`; stored graphs never carry it (`toStoredGraph` drops it). */
export const LABELLED_EDGE_TYPE = "labelled";

export type LabelledEdgeData = {
  /** The source handle id — the branch name, exactly as the node and the config panel show it. */
  label: string;
};

export type LabelledEdge = Edge<LabelledEdgeData, typeof LABELLED_EDGE_TYPE>;

export function EdgeWithLabel({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  markerEnd,
  style,
  data,
}: EdgeProps<LabelledEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const label = data?.label ?? "";

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          {/*
            `EdgeLabelRenderer` portals into a plain div layer above the SVG, so the chip is real
            text at every zoom rather than an SVG label that has to be re-measured. `nodrag nopan`
            keeps a stray click on it from panning the canvas. Placed a little above the midpoint so
            it does not sit on the wire it names.
          */}
          <span
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={cn(
              "nodrag nopan pointer-events-none absolute rounded-full border border-border",
              "bg-background/95 px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground",
            )}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
