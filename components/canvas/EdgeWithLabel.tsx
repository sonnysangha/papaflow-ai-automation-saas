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

import { edgeLabelPoint } from "./edge-label";

/**
 * A wire that says which way it goes.
 *
 * Only nodes that branch declare more than one source handle — Condition (`true`/`false`), Switch
 * (one per case), Loop (`each`/`done`), Approval (`approved`/`rejected`) — and on those the handle
 * *is* the answer the node gave. Reading it off the canvas is the difference between "these two
 * wires leave the same node" and "this one runs when the answer was no", so it is drawn on the wire
 * rather than left to a hover.
 *
 * What is drawn is the node's plain word for the handle (`handleLabel`), not the id: "no" rather
 * than "false", and the same word the node and the config panel show. The id keeps doing its job
 * underneath — it is what the stored edge and `steps.handle` match on.
 *
 * Every edge on a non-branching node stays the default bezier: a label reading "out" would be
 * noise, and `Canvas` only assigns this type where there is something to say.
 */

/** The edge type id registered in `Canvas`; stored graphs never carry it (`toStoredGraph` drops it). */
export const LABELLED_EDGE_TYPE = "labelled";

export type LabelledEdgeData = {
  /** The branch's plain word, exactly as the node and the config panel show it ("yes", "no"). */
  label: string;
  /** Which of the source node's handles this edge leaves, 0-based and top to bottom. */
  handleIndex: number;
  /** How many handles that node has — the other half of "keep these two labels apart". */
  handleCount: number;
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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const label = data?.label ?? "";
  // Deliberately not `getBezierPath`'s own `labelX/labelY`: that is the midpoint, and two branches
  // of one node share it often enough that "approved" and "rejected" end up stacked. See
  // `edge-label.ts`.
  const { x: labelX, y: labelY } = edgeLabelPoint({
    sourceX,
    sourceY,
    targetX,
    targetY,
    handleIndex: data?.handleIndex,
    handleCount: data?.handleCount,
  });

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          {/*
            `EdgeLabelRenderer` portals into a plain div layer above the SVG, so the chip is real
            text at every zoom rather than an SVG label that has to be re-measured. `nodrag nopan`
            keeps a stray click on it from panning the canvas. Placed near the source and staggered
            by handle, so a node's branches never write over each other.
          */}
          <span
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={label}
            className={cn(
              "nodrag nopan pointer-events-none absolute max-w-32 truncate rounded-full border border-border",
              // Not mono any more: the chip carries words now ("each item"), not an identifier —
              // and at 11px it is legible at the zoom people actually work at.
              "bg-card px-1.5 py-px text-[11px] leading-4 font-medium text-muted-foreground shadow-sm",
            )}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
