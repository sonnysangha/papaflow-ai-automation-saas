/**
 * Redaction for anything durable the engine writes about a node's configuration.
 *
 * Two sinks make this necessary (CLAUDE.md rule 1): the `steps.input` column in Convex, which the
 * runs drawer renders verbatim, and the Workflow SDK's run log, which records every step argument
 * and return value and shows them in `npx workflow web` and the Vercel dashboard. Secrets are
 * supposed to arrive through `credential` (decrypted inside the step, never returned), but a user
 * can always type an API key into an HTTP node's `headers`, so the parsed inputs are masked before
 * `runNode` hands them to `markStep`.
 *
 * The rule is key-based and deliberately blunt: a matching key loses its whole value, whatever the
 * value is. Over-redacting a boolean like `hasToken` is cheap; leaking a bearer token is not.
 */

/** Keys whose values never survive: `Authorization`, `api_key`, `refresh_token`, `Cookie`, … */
const SECRET_KEY = /secret|token|api[-_]?key|password|authorization|cookie/i;

/** What a masked value reads as in the UI. */
export const REDACTED = "••••";

/**
 * A deep copy of `value` with every secret-looking key masked. Arrays keep their shape and index
 * order; plain objects are rebuilt key by key; everything else (strings, numbers, `Date`, class
 * instances) is returned as-is, so a `z.date()` input still serialises as a date.
 *
 * The input is expected to be JSON-shaped (it is about to be written to Convex): cyclic values are
 * not supported.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!isPlainObject(value)) return value;

  const masked: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    masked[key] = SECRET_KEY.test(key) ? REDACTED : redact(entry);
  }
  return masked;
}

/** Object literals and `Object.create(null)` records only — not Dates, Maps or class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
