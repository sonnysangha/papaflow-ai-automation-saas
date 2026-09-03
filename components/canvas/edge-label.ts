// Where a branch label sits on its wire.
//
// Two edges leaving the same node are two bezier curves that start a few pixels apart and end
// wherever their targets are, so their *midpoints* — which is where React Flow's own `labelX/labelY`
// land — are frequently the same point, and "approved" is drawn on top of "rejected". Reading the
// canvas then needs a click on each wire.
//
// So the label is placed near the source instead, where the curves are still as far apart as their
// handles are, and staggered by which handle it left from. Both numbers are pure geometry, which is
// why they live here rather than inside the edge component: the arithmetic is testable and the
// component is markup.
//
// The control points are React Flow's own (`@xyflow/system`'s `getBezierPath`), reproduced rather
// than imported because that module exports the finished path string, not the curve. A label off
// this curve would float beside the wire it names.

/** React Flow's default bezier curvature; the canvas never overrides it. */
export const DEFAULT_CURVATURE = 0.25;

/**
 * How far along the curve the label sits, 0 at the source and 1 at the target.
 *
 * Near the source on purpose: at 0.3 a label has already inherited ~78% of its handle's own
 * vertical offset, so two branches of one node separate by roughly the distance between their
 * handles before the stagger is even applied.
 */
export const LABEL_T = 0.3;

/** Extra vertical separation between the labels of one node's branches, in flow units. */
export const LABEL_STAGGER = 14;

/** `calculateControlOffset` from `@xyflow/system`: half the distance, or a curl for a back-edge. */
export function controlOffset(distance: number, curvature = DEFAULT_CURVATURE): number {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
}

/** The cubic bezier at `t`. */
function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export type EdgeLabelPointArgs = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  /** Which of the source node's handles this edge leaves from, 0-based, top to bottom. */
  handleIndex?: number;
  /** How many handles that node has. One means no stagger: there is nothing to collide with. */
  handleCount?: number;
  t?: number;
  curvature?: number;
};

/**
 * Where to draw this edge's label.
 *
 * Written for the only orientation this canvas produces — a source handle on a node's right edge
 * and a target handle on another's left — which is what fixes the control points to
 * `(sourceX + offset, sourceY)` and `(targetX - offset, targetY)`. A back-edge (a Loop wired to a
 * node above it) is the same formula: `controlOffset` curls instead of halving when the target is
 * behind the source.
 *
 * The stagger is centred, so two branches land symmetrically either side of the curve and neither
 * one is the odd one out; a single-handle node gets none.
 */
export function edgeLabelPoint({
  sourceX,
  sourceY,
  targetX,
  targetY,
  handleIndex = 0,
  handleCount = 1,
  t = LABEL_T,
  curvature = DEFAULT_CURVATURE,
}: EdgeLabelPointArgs): { x: number; y: number } {
  const sourceControlX = sourceX + controlOffset(targetX - sourceX, curvature);
  const targetControlX = targetX - controlOffset(targetX - sourceX, curvature);

  const x = cubicAt(sourceX, sourceControlX, targetControlX, targetX, t);
  // The control points share their endpoint's y for a horizontal pair of handles, so the vertical
  // half of the curve is a cubic through (sourceY, sourceY, targetY, targetY).
  const y = cubicAt(sourceY, sourceY, targetY, targetY, t);

  const stagger =
    handleCount > 1 ? (handleIndex - (handleCount - 1) / 2) * LABEL_STAGGER : 0;

  return { x, y: y + stagger };
}
