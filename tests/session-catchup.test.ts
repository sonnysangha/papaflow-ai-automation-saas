import { describe, expect, it } from "vitest";

import { hasOpenTurn, type CatchupEvent } from "@/components/canvas/session-catchup";

/**
 * The decision that keeps reopening an existing Builder chat from sitting on "Catching up…": the
 * panel only follows the live stream when a turn is genuinely in flight.
 *
 * The event shapes here are the ones eve actually emits (`node_modules/eve/dist/src/protocol/
 * message.d.ts`), trimmed to the fields this helper reads.
 */

const event = (type: string, data?: unknown): CatchupEvent => ({ type, data });

/** The nine events a one-turn chat leaves behind, measured against a live session. */
const finishedTurn: readonly CatchupEvent[] = [
  event("session.started", {}),
  event("turn.started", { turnId: "t1" }),
  event("message.received", { turnId: "t1" }),
  event("step.started", { turnId: "t1" }),
  event("message.appended", { turnId: "t1" }),
  event("message.completed", { turnId: "t1" }),
  event("step.completed", { turnId: "t1" }),
  event("turn.completed", { turnId: "t1" }),
  event("session.waiting", { continuationToken: "wrun_1", wait: "next-user-message" }),
];

describe("hasOpenTurn", () => {
  it("is false for a chat parked on session.waiting", () => {
    expect(hasOpenTurn(finishedTurn)).toBe(false);
  });

  it("is false for a session that completed or failed", () => {
    expect(hasOpenTurn([...finishedTurn.slice(0, 7), event("session.completed", {})])).toBe(false);
    expect(hasOpenTurn([...finishedTurn.slice(0, 7), event("session.failed", { code: "X" })])).toBe(
      false,
    );
  });

  it("is false for a chat with no events at all", () => {
    expect(hasOpenTurn([])).toBe(false);
  });

  it("is true mid-turn, wherever the read stopped", () => {
    expect(hasOpenTurn(finishedTurn.slice(0, 2))).toBe(true);
    expect(hasOpenTurn(finishedTurn.slice(0, 5))).toBe(true);
    // `turn.completed` is not a session boundary: `session.waiting` is still on its way.
    expect(hasOpenTurn(finishedTurn.slice(0, 8))).toBe(true);
  });

  it("is true for a second turn started after the first parked", () => {
    expect(hasOpenTurn([...finishedTurn, event("turn.started", { turnId: "t2" })])).toBe(true);
  });

  it("is false while a question is waiting on the reader", () => {
    const asked = [
      ...finishedTurn.slice(0, 4),
      event("input.requested", { requests: [{ requestId: "r1", kind: "question" }], turnId: "t1" }),
    ];
    expect(hasOpenTurn(asked)).toBe(false);
  });

  it("is true again once every question has been answered", () => {
    const answered = [
      ...finishedTurn.slice(0, 4),
      event("input.requested", { requests: [{ requestId: "r1" }, { requestId: "r2" }] }),
      event("input.resolved", { resolutions: [{ requestId: "r1", outcome: "answered" }] }),
    ];
    expect(hasOpenTurn(answered)).toBe(false);

    expect(
      hasOpenTurn([...answered, event("input.resolved", { resolutions: [{ requestId: "r2" }] })]),
    ).toBe(true);
  });

  it("follows a session parked on an authorization eve finishes by itself", () => {
    const parked = [
      ...finishedTurn.slice(0, 4),
      event("authorization.required", { name: "slack", webhookUrl: "https://eve.example/cb" }),
      event("session.waiting", { continuationToken: "wrun_1", wait: "next-user-message" }),
    ];
    expect(hasOpenTurn(parked)).toBe(true);

    // Once it completes the turn runs on, so the tail decides again: mid-turn is still open…
    const resumed = [...parked, event("authorization.completed", { name: "slack" })];
    expect(hasOpenTurn(resumed)).toBe(true);
    // …and the chat is settled once it parks for the next message.
    expect(hasOpenTurn([...resumed, finishedTurn[8]])).toBe(false);
  });

  it("ignores an authorization note that parks nothing", () => {
    // No `webhookUrl`: nothing is waiting out of band, so the tail still decides.
    const noted = [...finishedTurn, event("authorization.required", { name: "slack" })];
    expect(hasOpenTurn(noted)).toBe(true); // tail is no longer a boundary
    expect(hasOpenTurn([...finishedTurn.slice(0, 8), event("authorization.required", { name: "slack" }), finishedTurn[8]])).toBe(false);
  });

  it("survives events whose data is missing or the wrong shape", () => {
    expect(hasOpenTurn([event("session.waiting")])).toBe(false);
    expect(hasOpenTurn([event("input.requested", { requests: "nope" }), event("session.waiting")])).toBe(
      false,
    );
    expect(hasOpenTurn([event("input.requested", { requests: [{}, 7] }), event("session.waiting")])).toBe(
      false,
    );
  });
});
