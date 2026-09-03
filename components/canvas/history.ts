/**
 * Undo/redo for the canvas: a stack of whole-graph snapshots.
 *
 * No React in here on purpose. The interesting rules — what counts as one undo step, how deep the
 * stack goes, what happens to the redos when you edit after undoing — are the parts worth testing,
 * and they are all pure functions of a `History` and a new snapshot.
 *
 * Snapshots are whole graphs rather than diffs. A workflow graph is small (tens of nodes), the
 * canvas already re-renders from a fresh array on every change, and "restore this exact graph" is
 * the operation Undo has to be right about — an inverse-patch scheme would have to be right about
 * every kind of edit instead.
 */

/**
 * Edits closer together than this join the entry before them instead of becoming their own undo
 * step. A drag emits a change per frame and typing a channel name emits one per keystroke; without
 * coalescing, Undo would walk back through sixty of them.
 */
export const COALESCE_MS = 300;

/** How many undo steps are kept. Old entries fall off the bottom; the graph they hold is not tiny. */
export const HISTORY_LIMIT = 100;

export type History<T> = {
  /** Older snapshots, oldest first. The last one is what Undo restores. */
  readonly past: readonly T[];
  /** What the canvas is showing. */
  readonly present: T;
  /** Snapshots undone away, nearest first. Cleared by the next edit. */
  readonly future: readonly T[];
  /** When `present` was recorded — the clock coalescing is measured against. */
  readonly at: number;
};

export type PushOptions = {
  /** Defaults to `COALESCE_MS`. */
  coalesceMs?: number;
  /** Defaults to `HISTORY_LIMIT`. */
  limit?: number;
};

export function createHistory<T>(present: T, at = 0): History<T> {
  return { past: [], present, future: [], at };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/**
 * Records a new snapshot.
 *
 * Three rules, in order:
 *
 * 1. an edit within `coalesceMs` of the last one replaces `present` rather than pushing it down,
 *    so a drag is one Undo away — except when it follows an undo, where the restored snapshot has
 *    to survive as its own step or Undo would jump two;
 * 2. an edit always clears `future`: the redos belong to a branch the user just left;
 * 3. `past` never grows past `limit`; the oldest entry is dropped.
 *
 * The very first edit after loading never coalesces, so the graph as it was saved is always one
 * Undo away.
 */
export function pushHistory<T>(
  history: History<T>,
  next: T,
  at: number,
  options: PushOptions = {},
): History<T> {
  const coalesceMs = options.coalesceMs ?? COALESCE_MS;
  const limit = options.limit ?? HISTORY_LIMIT;

  const coalesce =
    history.past.length > 0 && history.future.length === 0 && at - history.at < coalesceMs;
  if (coalesce) return { past: history.past, present: next, future: [], at };

  const past = [...history.past, history.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
    at,
  };
}

/** One step back, or the same history when there is nothing to undo. */
export function undo<T>(history: History<T>, at = history.at): History<T> {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    at,
  };
}

/** One step forward, or the same history when there is nothing to redo. */
export function redo<T>(history: History<T>, at = history.at): History<T> {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
    at,
  };
}
