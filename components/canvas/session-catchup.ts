/**
 * The one decision behind reopening an existing Builder chat: is the agent still working on it?
 *
 * `useEveAgent({ resume: true })` replays a durable session and then *follows* it, and eve's own
 * idea of "settled" (`isSettledSessionTail` in `eve/dist/src/client/eve-agent-store-helpers.js`)
 * keeps following a session whose last event is `session.waiting` — which is exactly where every
 * finished chat parks ("the session parks waiting for the next user message"). Nothing ever
 * arrives on that follow, so it ends only when the client's own 15s read-idle timeout fires
 * (`readNdjsonStream(..., { idleTimeoutMs: 15e3 })`), and the store reports `resuming` — the
 * panel's "Catching up…", with the composer disabled — for the whole window. Measured against
 * production: 0.46s to read a nine-event chat, then 15.3s of silence.
 *
 * So the panel reads the transcript itself with a bounded, non-following stream and asks this
 * module whether to follow at all.
 *
 * Like `scroll-follow.ts`, the shape is structural rather than eve's own union: every
 * `MessageStreamEvent` satisfies `CatchupEvent`, and a plain object satisfies it in the node test
 * project.
 */

/** The stream-event shape this module reads. Every eve `MessageStreamEvent` satisfies it. */
export type CatchupEvent = {
  readonly type: string;
  readonly data?: unknown;
};

/**
 * The three events that end the current turn — the same set as eve's `isCurrentTurnBoundaryEvent`.
 * `turn.completed` is not one of them: it is always chased by `session.waiting`.
 */
const TURN_BOUNDARY: ReadonlySet<string> = new Set([
  "session.completed",
  "session.failed",
  "session.waiting",
]);

function read(data: unknown, key: string): unknown {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>)[key] : undefined;
}

/** The `requestId`s inside an `input.requested`/`input.resolved` event's batch. */
function requestIds(data: unknown, key: "requests" | "resolutions"): readonly string[] {
  const list = read(data, key);
  if (!Array.isArray(list)) return [];

  const ids: string[] = [];
  for (const entry of list as readonly unknown[]) {
    const id = read(entry, "requestId");
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

/** Questions the reader has not answered yet: `ask()` from a durable tool, or a tool approval. */
function pendingInputRequests(events: readonly CatchupEvent[]): ReadonlySet<string> {
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === "input.requested") {
      for (const id of requestIds(event.data, "requests")) open.add(id);
    } else if (event.type === "input.resolved") {
      for (const id of requestIds(event.data, "resolutions")) open.delete(id);
    }
  }
  return open;
}

/**
 * Out-of-band authorizations eve finishes by itself. `webhookUrl` is what makes one of these a
 * park rather than a note: the turn continues when the round trip completes, with no help from the
 * panel, so the stream is worth following.
 */
function pendingAuthorizations(events: readonly CatchupEvent[]): ReadonlySet<string> {
  const open = new Set<string>();
  for (const event of events) {
    const name = read(event.data, "name");
    if (typeof name !== "string") continue;

    if (event.type === "authorization.required" && read(event.data, "webhookUrl") !== undefined) {
      open.add(name);
    } else if (event.type === "authorization.completed") {
      open.delete(name);
    }
  }
  return open;
}

/**
 * Is a turn genuinely in flight at the end of this transcript — the only case where the panel
 * should open a following stream and say "Catching up…"?
 *
 * A chat parked on a question is *not* in flight: the agent is waiting for the reader, and
 * following it would only disable the buttons the reader has to press.
 */
export function hasOpenTurn(events: readonly CatchupEvent[]): boolean {
  const tail = events.at(-1);
  if (tail === undefined) return false;

  if (pendingInputRequests(events).size > 0) return false;
  if (pendingAuthorizations(events).size > 0) return true;

  return !TURN_BOUNDARY.has(tail.type);
}
