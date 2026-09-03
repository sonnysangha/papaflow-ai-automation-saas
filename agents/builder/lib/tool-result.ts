import { ConvexError } from "convex/values";

import {
  EngineUnavailableError,
  isEngineUnavailable,
  safeErrorMessage,
} from "../../../lib/engine-env";

/**
 * How a Builder tool fails when the failure is not the model's to fix.
 *
 * There are two kinds of failure in this agent and they want opposite handling:
 *
 * - **A refusal** — a node type that does not exist, a handle a node does not offer, a workflow
 *   that is not this organisation's, a plan without the Builder feature. It throws, the model reads
 *   the sentence and does something different. `lib/edits.ts` is full of these on purpose.
 * - **An unreachable backend** — no `CONVEX_URL` on the service, Convex refusing the shared secret,
 *   a transport error. Nothing the model does next can help, and a model handed a bare error will
 *   cheerfully call the same tool nine more times (which is exactly what production did before this
 *   existed). So it is *returned*, not thrown: a structured, terminal result the instructions tell
 *   the model to stop on.
 *
 * Every tool wraps its body in `toolResult`, so the nine of them stay three lines each.
 */

/** The message a rejected shared secret earns, because "unauthorized" tells an operator nothing. */
const SHARED_SECRET_REJECTED =
  "Convex rejected PapaFlow's shared secret — ENGINE_SECRET on this service and on the Convex " +
  "deployment (npx convex env set ENGINE_SECRET) do not match";

/** The terminal result. `retryable: false` is the part the model is instructed to obey. */
export type ToolFailure = {
  ok: false;
  error: "service_unavailable";
  message: string;
  retryable: false;
};

/** Narrows a step's return value, which crosses the workflow boundary as plain data. */
export function isToolFailure(value: unknown): value is ToolFailure {
  if (typeof value !== "object" || value === null) return false;
  const { ok, error } = value as { ok?: unknown; error?: unknown };
  return ok === false && error === "service_unavailable";
}

/**
 * The `{ code, message }` a Convex function threw, or `null` when this is not a Convex refusal.
 *
 * The `name` check is the load-bearing half. `instanceof` is the honest test, but this module is
 * compiled into two bundled eve services, and a second copy of `convex/values` in either bundle
 * would silently turn every ordinary refusal ("There is no node …", a version conflict) into
 * `service_unavailable` and end the turn blaming the deployment. Matching the shape as well keeps a
 * duplicated dependency from changing what the model is told.
 */
function convexRefusal(error: unknown): { code?: unknown; message?: unknown } | null {
  const named =
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ConvexError";
  if (!(error instanceof ConvexError) && !named) return null;

  const data: unknown = (error as { data?: unknown }).data;
  return typeof data === "object" && data !== null ? (data as { code?: unknown }) : {};
}

/** An error's sentence, scrubbed, with a fallback for the ones thrown with nothing in them. */
function messageOf(error: unknown): string {
  const text = safeErrorMessage(error);
  return text.length > 0 ? text : "the backend could not be reached";
}

/**
 * The failure a tool hands back. The message names the variable rather than describing a mood,
 * because the person who has to act on it is an operator reading it over the user's shoulder.
 *
 * The sentence goes through `safeErrorMessage` first. `lib/engine-env.ts` only ever puts variable
 * names in the messages it writes itself, but half of what lands here came back from Convex — an
 * argument-validation failure echoes the arguments it refused, and `secret` is one of them — and
 * this object is read by the model, shown in the chat panel, and recorded as a `"use step"` return
 * value by the Workflow SDK (CLAUDE.md rule 1).
 */
export function serviceUnavailable(error: unknown): ToolFailure {
  return {
    ok: false,
    error: "service_unavailable",
    message: `The Builder cannot reach PapaFlow's backend: ${messageOf(error)}.`,
    retryable: false,
  };
}

/**
 * The terminal result for an error that is infrastructure's, or `null` when it is the model's.
 *
 * Two things qualify, and the second is not obvious: `convex/builder.ts` and `convex/engine.ts`
 * both answer a missing or mismatched `ENGINE_SECRET` with `ConvexError({ code: "unauthorized" })`,
 * which looks exactly like a refusal and is nothing of the kind — a fresh per-branch preview
 * deployment that has not had `npx convex env set ENGINE_SECRET` repeated on it answers every call
 * that way, and a model told "unauthorized" retries.
 */
export function asServiceFailure(error: unknown): ToolFailure | null {
  if (isEngineUnavailable(error)) return serviceUnavailable(error);

  const refusal = convexRefusal(error);
  if (refusal && refusal.code === "unauthorized") {
    return serviceUnavailable(new EngineUnavailableError(SHARED_SECRET_REJECTED, { cause: error }));
  }

  return null;
}

/**
 * One call into Convex, classified.
 *
 * A `ConvexError` is the backend deliberately refusing something (`convex/builder.ts` throws
 * `ConvexError({ code, message })` for a workflow that is not this org's, a node that is not in the
 * graph, a version conflict) — a refusal, passed through untouched for the caller to turn into a
 * sentence. The one exception is `code: "unauthorized"`, which is the shared-secret gate rather
 * than an opinion about the graph. Anything else reaching a `ConvexHttpClient` call is
 * infrastructure: a missing variable, a network failure, a 500 from a broken deployment. Those
 * become `EngineUnavailableError`, and stop being the model's problem.
 */
export async function viaEngine<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isEngineUnavailable(error)) throw error;

    const refusal = convexRefusal(error);
    if (refusal) {
      if (refusal.code !== "unauthorized") throw error;
      throw new EngineUnavailableError(SHARED_SECRET_REJECTED, { cause: error });
    }

    throw new EngineUnavailableError(messageOf(error), { cause: error });
  }
}

/**
 * A tool body. Refusals still throw; an unreachable backend comes back as a terminal result.
 *
 * @example
 * async execute(args, ctx) {
 *   return await toolResult(async () => {
 *     const session = await requireBuilder(ctx);
 *     return await addNode(session, args);
 *   });
 * }
 */
export async function toolResult<T>(run: () => Promise<T>): Promise<T | ToolFailure> {
  try {
    return await run();
  } catch (error) {
    const failure = asServiceFailure(error);
    if (failure) return failure;
    throw error;
  }
}
