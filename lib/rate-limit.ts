/**
 * A very small in-memory sliding window, for the public surfaces that have no session to throttle
 * on (today: the hosted form). Per key it keeps the timestamps inside the window and answers
 * whether one more is allowed.
 *
 * What this is not: a real rate limiter. The map lives in one Node process, so a Vercel deployment
 * with several instances gives each of them its own budget, and a cold start forgets everything.
 * That is fine for the job it has — making a bored script's 1000 submissions a second uninteresting
 * — and it costs no network round trip on the happy path. A serious guard (Turnstile, or a shared
 * counter) is a later, deliberate change; see the Phase 5 plan.
 */

/** Timestamps of the calls still inside the window, oldest first. */
const hits = new Map<string, number[]>();

/**
 * How many keys we are willing to remember. Reached only under an attack from many IPs, and a
 * lost bucket just means one extra allowance — far better than an unbounded map in a warm lambda.
 */
const MAX_KEYS = 10_000;

/**
 * True when this call fits inside `limit` calls per `windowMs` for `key`, and counts it. False
 * means the caller should refuse the request — nothing is recorded for a refused call, so a
 * blocked client recovers exactly `windowMs` after its own last accepted call.
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const since = now - windowMs;

  const recent = (hits.get(key) ?? []).filter((at) => at > since);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  if (!hits.has(key) && hits.size >= MAX_KEYS) evict(since);
  hits.set(key, recent);
  return true;
}

/** Drops every key whose calls have all fallen out of the window; clears the map if none have. */
function evict(since: number): void {
  for (const [key, times] of hits) {
    if (times.every((at) => at <= since)) hits.delete(key);
  }
  if (hits.size >= MAX_KEYS) hits.clear();
}

/** Forgets one key's window, or all of them. For tests. */
export function resetRateLimit(key?: string): void {
  if (key === undefined) hits.clear();
  else hits.delete(key);
}
