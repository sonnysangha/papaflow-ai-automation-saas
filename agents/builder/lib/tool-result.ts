import { ConvexError } from "convex/values";

import { EngineUnavailableError, isEngineUnavailable } from "../../../lib/engine-env";

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

/** An error's sentence, with a fallback for the ones thrown with nothing in them. */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? "").trim();
  return text.length > 0 ? text : "the backend could not be reached";
}

/**
 * The failure a tool hands back. The message names the variable rather than describing a mood,
 * because the person who has to act on it is an operator reading it over the user's shoulder — and
 * `lib/engine-env.ts` only ever puts variable names in these sentences, never a value.
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
 * One call into Convex, classified.
 *
 * A `ConvexError` is the backend deliberately refusing something (`convex/builder.ts` throws
 * `ConvexError({ code, message })` for a workflow that is not this org's, a node that is not in the
 * graph, a version conflict) — a refusal, passed through untouched for the caller to turn into a
 * sentence. Anything else reaching a `ConvexHttpClient` call is infrastructure: a missing variable,
 * a 401 on the shared secret, a network failure, a 500 from a broken deployment. Those become
 * `EngineUnavailableError`, and stop being the model's problem.
 */
export async function viaEngine<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isEngineUnavailable(error)) throw error;
    if (error instanceof ConvexError) throw error;
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
    if (isEngineUnavailable(error)) return serviceUnavailable(error);
    throw error;
  }
}
