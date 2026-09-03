/**
 * Where a session-less process finds Convex, and what it does when it cannot.
 *
 * Three kinds of caller share this: the workflow engine's steps (`lib/engine-client.ts`), the eve
 * Runtime agent (`lib/connections-engine.ts`) and the eve Builder (`lib/builder-engine.ts`). None of
 * them has a Clerk session, so they all authenticate with `ENGINE_SECRET` (CLAUDE.md rule 5) — and
 * they all need a Convex URL, which is where the deployment topology bites:
 *
 * `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` injects the
 * URL into the **Next build process only**, where Next inlines it into the Next bundle. The eve
 * services are separate Vercel services built from the same project: they see the project's
 * environment variables, and `NEXT_PUBLIC_CONVEX_URL` is not one of them. So Production and Preview
 * carry a plain project variable `CONVEX_URL` with the same value, and every engine-side lookup
 * prefers it, falling back to the Next-inlined one so local development and `pnpm test` keep
 * working with nothing but the `.env.local` that `npx convex dev` writes.
 *
 * The read is deliberately per call, never captured at import time: a client frozen at module load
 * would freeze whatever the bundler happened to see.
 */

/** How the missing-URL sentence names the pair, so an operator knows both spellings work. */
const CONVEX_URL_NAMES = "CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL)";

/** What a redacted value looks like in a log line or a tool result. */
const REDACTED = "••••";

/** Longest error text `safeErrorMessage` will carry. A log line is not a place for a stack. */
const MAX_MESSAGE_LENGTH = 300;

/**
 * `field: value` pairs whose value is dropped whatever it is.
 *
 * Convex answers an argument-validation failure by echoing the arguments it refused — and every
 * call from these modules passes `secret` as one of them. Masking the known `ENGINE_SECRET` covers
 * the case where this process holds the same value; this covers the case where it does not (a
 * rotated or mismatched secret is exactly when that error fires).
 */
const SECRET_FIELDS =
  /(\b(?:secret|token|api[_-]?key|apikey|password|authorization)\b"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi;

/**
 * A configuration failure the caller cannot retry its way out of.
 *
 * The distinction matters most in the eve services: a model handed a plain `Error` treats it as a
 * hiccup and calls the same tool again (the Builder retried `list_connections` nine times against a
 * deployment with no `CONVEX_URL` before giving up), while `retryable: false` plus a structured
 * tool result is a full stop. `code` is the string that reaches the model.
 */
export class EngineUnavailableError extends Error {
  readonly code = "service_unavailable" as const;
  readonly retryable = false as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EngineUnavailableError";
  }
}

/**
 * Whether an error means "the service is not reachable", by class or by shape.
 *
 * The shape check is not decoration: an error thrown inside a `"use step"` function is hydrated
 * through the Workflow SDK's serialization pipeline before a workflow body catches it, and the
 * class identity does not survive that trip — `name` does.
 */
export function isEngineUnavailable(error: unknown): error is EngineUnavailableError {
  if (error instanceof EngineUnavailableError) return true;
  if (typeof error !== "object" || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === "EngineUnavailableError" || code === "service_unavailable";
}

/** A value read from the environment, treating "set to empty" as not set. */
function normalise(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * The Convex deployment this process should talk to: the project variable first, the inlined Next
 * one second. Never throws — `engineEnv()` is the one that insists.
 *
 * **Both reads are spelled out literally on purpose.** Next replaces the exact source text
 * `process.env.NEXT_PUBLIC_CONVEX_URL` at build time — `next/dist/lib/static-env.js` emits one
 * define per NEXT_PUBLIC_* variable, keyed on that literal expression, into the server bundle as
 * well as the browser one — and that substitution is the only reason the fallback exists at all:
 * `NEXT_PUBLIC_CONVEX_URL` is never a Vercel project variable, so it is not in the function
 * runtime's `process.env`. A computed read — `process.env[name]` — is not replaced, which would
 * quietly make `CONVEX_URL` mandatory for every run, trigger and schedule rather than just for the
 * two eve services. `tests/engine-env.test.ts` pins the spelling.
 */
export function convexUrl(): string | undefined {
  return normalise(process.env.CONVEX_URL) ?? normalise(process.env.NEXT_PUBLIC_CONVEX_URL);
}

/** The shared secret `convex/engine.ts` compares against before it runs anything. */
export function engineSecret(): string | undefined {
  return normalise(process.env.ENGINE_SECRET);
}

/**
 * One line's worth of an error: no secret, no newlines, no essay.
 *
 * Everything that shows an engine failure to somebody — a Vercel function log, a Builder tool
 * result the model reads and quotes into the chat panel, a `"use step"` return value the Workflow
 * dashboard records — puts the text through here first. `lib/engine-env.ts` only ever writes
 * variable *names* into its own messages, but the text arriving from Convex is not ours (CLAUDE.md
 * rule 1).
 */
export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const secret = engineSecret();
  const masked = secret ? raw.split(secret).join(REDACTED) : raw;
  return masked
    .replace(SECRET_FIELDS, `$1${REDACTED}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

export type EngineEnv = { url: string; secret: string };

/**
 * The URL and the secret, or a refusal naming exactly what is missing.
 *
 * `scope` prefixes the sentence with the module that asked ("builder-engine"), because on Vercel
 * this message is read in a function log next to three other services' logs.
 *
 * @throws EngineUnavailableError — terminal, never worth a retry.
 */
export function engineEnv(scope?: string): EngineEnv {
  const url = convexUrl();
  const secret = engineSecret();

  if (!url || !secret) {
    const missing: string[] = [];
    if (!url) missing.push(`${CONVEX_URL_NAMES} is not set`);
    if (!secret) missing.push("ENGINE_SECRET is not set");
    throw new EngineUnavailableError(`${scope ? `${scope}: ` : ""}${missing.join(" and ")}`);
  }

  return { url, secret };
}
