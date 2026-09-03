import { EngineUnavailableError } from "../../../lib/engine-env";

/**
 * How the Builder asks the Next app to press a button it cannot press itself.
 *
 * Two of the agent's tools need something that only exists inside the Next build: `run_workflow`
 * needs `start(runGraph, …)`, and `finish` needs the durable scheduler run that publishing a
 * Schedule trigger starts. A workflow function is only a workflow once the Workflow SDK's compiler
 * has transformed it, and that transform runs in the *Next* build — `withWorkflow()` wires the
 * loaders and writes the `/.well-known/workflow/*` routes, while `withEve()` writes each agent as
 * its own Vercel Build Output service, so a workflow inside an agent belongs to that agent's
 * service (`docs/research/eve-spike.md`, Phase 12 addendum item 5). Importing `lib/engine-client.ts`
 * here to try would also drag `runGraph`, every step file and the whole node registry's I/O into
 * the agent's bundle, which is the thing `lib/builder-engine.ts` exists to avoid.
 *
 * So the agent knocks on a route instead, over the same shared secret every other session-less
 * caller uses (CLAUDE.md rule 5), and the route runs the *same* function the user's own button
 * runs. One transport for both, so a route that answers "no" answers it the same way twice.
 */

/** Where the Next app answers. The eve service carries it as APP_ORIGIN, like every other service. */
function appOrigin(): string {
  const origin = (process.env.APP_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!origin) {
    throw new EngineUnavailableError("builder: APP_ORIGIN is not set on this service");
  }
  return origin;
}

/** The shared secret the engine routes compare. Missing it is a deployment problem, not a model one. */
function engineSecret(): string {
  const secret = (process.env.ENGINE_SECRET ?? "").trim();
  if (!secret) {
    throw new EngineUnavailableError("builder: ENGINE_SECRET is not set on this service");
  }
  return secret;
}

/**
 * A refusal the route named, so a caller can tell "your plan will not run this schedule" from "that
 * is not a workflow" without parsing the sentence it was given.
 *
 * `routeCode` rather than `code`: `EngineUnavailableError` carries `code: "service_unavailable"`
 * and `isEngineUnavailable()` matches on it, so a body's own `code` must never land there.
 */
export type RouteRefusal = Error & { routeCode?: string };

/** The `code` the route answered a 4xx with, or "". */
export function routeCodeOf(error: unknown): string {
  const code = (error as RouteRefusal | null)?.routeCode;
  return typeof code === "string" ? code : "";
}

/**
 * One POST to an `ENGINE_SECRET`-authenticated route in the Next app, classified the way the
 * Builder's tools need it.
 *
 * - **2xx** — the parsed JSON body, for the caller to read what it asked for out of.
 * - **401 or 5xx** — ours to fix: a rotated secret, a deployment without one, an app that is down.
 *   `EngineUnavailableError` is terminal, and `toolResult()` turns it into the structured result
 *   the instructions tell the model to stop on rather than something it will retry nine times.
 * - **Any other 4xx** — the model's to act on: a plan that refuses the schedule, a workflow with no
 *   trigger, a monthly run limit. Thrown as a plain `Error` carrying the route's own sentence,
 *   plus `routeCode` for a caller that wants to say more about a particular one.
 *
 * @param refusal what to say for a 4xx that came back without a sentence of its own.
 */
export async function callEngineRoute(
  path: string,
  payload: Record<string, unknown>,
  refusal = "The app refused the request",
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${appOrigin()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${engineSecret()}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new EngineUnavailableError(`builder: the app did not answer ${path}`, { cause });
  }

  const parsed: unknown = await response.json().catch(() => null);
  const body: Record<string, unknown> =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const detail = typeof body.error === "string" ? body.error : "";

  if (response.ok) return body;

  if (response.status === 401 || response.status >= 500) {
    throw new EngineUnavailableError(
      `builder: ${path} answered ${response.status} — ${detail || "no detail"}`,
    );
  }

  const error: RouteRefusal = new Error(detail || `${refusal} (${response.status}).`);
  if (typeof body.code === "string") error.routeCode = body.code;
  throw error;
}
