import { getBezierPath, Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  controlOffset,
  edgeLabelPoint,
  LABEL_STAGGER,
  LABEL_T,
} from "@/components/canvas/edge-label";

/** A Condition at (0,0) with two handles 24px apart, wired to two nodes 300px to the right. */
const YES = { sourceX: 0, sourceY: -12, targetX: 300, targetY: -80 };
const NO = { sourceX: 0, sourceY: 12, targetX: 300, targetY: 80 };

describe("controlOffset", () => {
  it("halves a forward run and curls a backward one", () => {
    expect(controlOffset(300)).toBe(150);
    expect(controlOffset(0)).toBe(0);
    // A Loop wired back to a node above it: the control point reaches *out* rather than crossing.
    expect(controlOffset(-100)).toBeCloseTo(0.25 * 25 * 10);
    expect(controlOffset(-100)).toBeGreaterThan(0);
  });
});

describe("edgeLabelPoint", () => {
  it("sits on the wire it names", () => {
    // The curve React Flow actually draws, sampled at the same t by an independent route: the
    // path's start, its two control points and its end, straight out of `getBezierPath`.
    const [path] = getBezierPath({
      ...YES,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
    const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers).toHaveLength(8);
    const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers;

    const at = (p0: number, p1: number, p2: number, p3: number, t: number) => {
      const u = 1 - t;
      return u ** 3 * p0 + 3 * u ** 2 * t * p1 + 3 * u * t ** 2 * p2 + t ** 3 * p3;
    };

    const point = edgeLabelPoint({ ...YES, handleIndex: 0, handleCount: 1 });
    expect(point.x).toBeCloseTo(at(x0, x1, x2, x3, LABEL_T), 5);
    expect(point.y).toBeCloseTo(at(y0, y1, y2, y3, LABEL_T), 5);
  });

  it("keeps two branches of one node apart, which the midpoint does not", () => {
    const yes = edgeLabelPoint({ ...YES, handleIndex: 0, handleCount: 2 });
    const no = edgeLabelPoint({ ...NO, handleIndex: 1, handleCount: 2 });

    // A label chip is ~18px tall, so anything less than that is two chips on top of each other.
    expect(Math.abs(yes.y - no.y)).toBeGreaterThan(24);
    // …and both are still near the source, where the curves have not converged yet.
    expect(yes.x).toBeLessThan(150);
    expect(no.x).toBeLessThan(150);
  });

  it("staggers symmetrically, so neither branch is the odd one out", () => {
    const plain = edgeLabelPoint({ ...YES, handleIndex: 0, handleCount: 1 });
    const upper = edgeLabelPoint({ ...YES, handleIndex: 0, handleCount: 2 });
    const lower = edgeLabelPoint({ ...YES, handleIndex: 1, handleCount: 2 });

    expect(upper.y).toBeCloseTo(plain.y - LABEL_STAGGER / 2, 5);
    expect(lower.y).toBeCloseTo(plain.y + LABEL_STAGGER / 2, 5);
    // The stagger is vertical only: the label must not slide along the wire.
    expect(upper.x).toBeCloseTo(plain.x, 5);
  });

  it("spreads a Switch's cases across its whole column", () => {
    const ys = [0, 1, 2, 3].map(
      (index) =>
        edgeLabelPoint({
          sourceX: 0,
          sourceY: (index - 1.5) * 26,
          targetX: 300,
          targetY: 0,
          handleIndex: index,
          handleCount: 4,
        }).y,
    );

    // Monotonic top to bottom, and no two adjacent cases within a chip's height of each other.
    for (let index = 1; index < ys.length; index++) {
      expect(ys[index] - ys[index - 1]).toBeGreaterThan(24);
    }
  });

  it("does not stagger a node with one way out", () => {
    const single = edgeLabelPoint({ ...YES, handleIndex: 0, handleCount: 1 });
    const bare = edgeLabelPoint(YES);
    expect(single).toEqual(bare);
  });
});
