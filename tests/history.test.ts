import { describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
  type History,
  type PushOptions,
} from "@/components/canvas/history";

/**
 * The undo stack. The canvas pushes whole graphs through it; strings stand in for them here,
 * because none of the rules worth testing care what a snapshot is.
 *
 * Timestamps are passed in rather than read from a clock, so "these two edits were 40ms apart"
 * is something a test states rather than races.
 */
const OPTIONS: PushOptions = { coalesceMs: 300, limit: 100 };

function push(history: History<string>, value: string, at: number, options = OPTIONS) {
  return pushHistory(history, value, at, options);
}

describe("pushHistory", () => {
  it("makes the first edit its own step, however soon it lands", () => {
    // The graph as it was loaded has to stay one Undo away even if the user drags a node
    // immediately, so nothing coalesces into it.
    const history = push(createHistory("loaded"), "a", 10);

    expect(history.past).toEqual(["loaded"]);
    expect(history.present).toBe("a");
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);
  });

  it("folds edits inside the coalescing window into one step", () => {
    // One drag: a change per frame, all of it one Undo.
    let history = push(createHistory("loaded"), "a", 1000);
    history = push(history, "b", 1100);
    history = push(history, "c", 1250);

    expect(history.past).toEqual(["loaded"]);
    expect(history.present).toBe("c");
    expect(undo(history).present).toBe("loaded");
  });

  it("starts a new step once the window has passed", () => {
    let history = push(createHistory("loaded"), "a", 1000);
    history = push(history, "b", 1400);

    expect(history.past).toEqual(["loaded", "a"]);
    expect(history.present).toBe("b");
  });

  it("measures the window from the last edit, not from the last step", () => {
    // Typing: every keystroke is inside 300ms of the one before it, so the whole word is one step
    // even though the first and last keystroke are a second apart.
    let history = push(createHistory("loaded"), "s", 1000);
    for (let at = 1200; at <= 2000; at += 200) history = push(history, `s${at}`, at);

    expect(history.past).toEqual(["loaded"]);
    expect(history.present).toBe("s2000");
  });

  it("drops the oldest step past the limit", () => {
    let history = createHistory("loaded");
    for (let n = 1; n <= 10; n++) history = push(history, `edit ${n}`, n * 1000, { ...OPTIONS, limit: 3 });

    expect(history.past).toEqual(["edit 7", "edit 8", "edit 9"]);
    expect(history.present).toBe("edit 10");
    // …and the cap holds as it keeps going, rather than the array creeping up by one each time.
    history = push(history, "edit 11", 11_000, { ...OPTIONS, limit: 3 });
    expect(history.past).toHaveLength(3);
  });

  it("throws the redos away when you edit after undoing", () => {
    let history = push(createHistory("loaded"), "a", 1000);
    history = push(history, "b", 2000);
    history = undo(history, 3000);

    expect(history.present).toBe("a");
    expect(canRedo(history)).toBe(true);

    history = push(history, "c", 4000);
    expect(canRedo(history)).toBe(false);
    expect(history.past).toEqual(["loaded", "a"]);
    expect(undo(history).present).toBe("a");
  });

  it("does not coalesce an edit onto a snapshot an undo just restored", () => {
    // Otherwise Undo would jump two: the restored snapshot would never have been a step of its own.
    let history = push(createHistory("loaded"), "a", 1000);
    history = push(history, "b", 2000);
    history = undo(history, 2000);
    history = push(history, "c", 2050);

    expect(history.present).toBe("c");
    expect(undo(history).present).toBe("a");
  });
});

describe("undo and redo", () => {
  it("walks back and forward through the steps", () => {
    let history = push(createHistory("loaded"), "a", 1000);
    history = push(history, "b", 2000);

    const back = undo(undo(history));
    expect(back.present).toBe("loaded");
    expect(canUndo(back)).toBe(false);
    expect(canRedo(back)).toBe(true);

    const forward = redo(redo(back));
    expect(forward.present).toBe("b");
    expect(canRedo(forward)).toBe(false);
    expect(forward.past).toEqual(["loaded", "a"]);
  });

  it("hands back the same history at either end", () => {
    const history = push(createHistory("loaded"), "a", 1000);

    // Identity, not just equality: the canvas skips the whole re-render when nothing moved.
    expect(redo(history)).toBe(history);
    const bottom = undo(history);
    expect(undo(bottom)).toBe(bottom);
  });

  it("reports what the buttons should do", () => {
    const fresh = createHistory("loaded");
    expect(canUndo(fresh)).toBe(false);
    expect(canRedo(fresh)).toBe(false);

    const edited = push(fresh, "a", 1000);
    expect(canUndo(edited)).toBe(true);
    expect(canRedo(edited)).toBe(false);
  });
});
