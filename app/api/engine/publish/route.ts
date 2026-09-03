import { z } from "zod";

import { getOrgPlan } from "@/lib/billing";
import { engineSecret, safeErrorMessage } from "@/lib/engine-env";
import { applyPublish } from "@/lib/publish-server";
import { safeEqual } from "@/lib/timing";
import type { ScheduleErrorCode } from "@/lib/schedules-server";

/**
 * `POST /api/engine/publish` — publishes (or unpublishes) a workflow on behalf of a session-less
 * caller that holds `ENGINE_SECRET`. Today that is exactly one caller: the Builder agent's `finish`
 * tool.
 *
 * **Why this route exists.** Publishing is not a status write. A Schedule trigger's "on" is the
 * workflow's `status` *and* a durable scheduler run sleeping until the next occurrence, and only
 * the Next app can `start()` one — a workflow function is only a workflow after the Workflow SDK's
 * compiler has transformed it, and that transform runs in the Next build, while `withEve()` writes
 * each agent as its own Vercel service (`docs/research/eve-spike.md`, Phase 12 addendum item 5).
 * So `finish` used to publish by calling a Convex mutation that moved the status alone, and a
 * schedule-triggered workflow the Builder built was published but never scheduled until a human
 * pressed Publish. It now knocks here, and this route calls the same `applyPublish` the Publish
 * button's server action calls — one implementation, one order of writes, one set of plan rules.
 *
 * **Authentication.** A bearer token compared with `timingSafeEqual`, against the same
 * `ENGINE_SECRET` every session-less caller already shares with Convex (CLAUDE.md rule 5). It is
 * not an authorization: `orgId` travels in the body and Convex re-checks the workflow against it,
 * so a caller holding the secret still cannot publish another organisation's workflow by guessing
 * an id.
 *
 * **The plan** comes from Clerk's Backend API rather than a session claim, because there is no
 * session (CLAUDE.md rule 10) — the same read every other engine-side caller makes.
 *
 * Node runtime: `applyPublish` reaches Convex and the Workflow SDK's `start()`.
 */
export const runtime = "nodejs";

const body = z.object({
  workflowId: z.string().min(1),
  orgId: z.string().min(1),
  /** Who asked. Informational — it lands in the server log, never on a row. */
  userId: z.string().min(1).optional(),
  /** True publishes, false takes the workflow back off the air. */
  publish: z.boolean(),
});

/**
 * The status each refusal earns.
 *
 * Deliberately *not* `SCHEDULE_ERROR_STATUS`: that map answers a browser, where `too_frequent` is a
 * 403 with an upgrade link. Here the caller is an agent, and every one of these but `not_found` and
 * `upstream_error` is something it can fix by editing the Schedule trigger and calling `finish`
 * again — so they are 400s, the status its tools read as "your problem, act on it" rather than
 * "the backend is down, end the turn".
 */
const PUBLISH_ERROR_STATUS: Record<ScheduleErrorCode, number> = {
  not_found: 404,
  upstream_error: 502,
  no_schedule_trigger: 400,
  invalid_schedule: 400,
  invalid_cron: 400,
  invalid_timezone: 400,
  too_frequent: 400,
};

/** The bearer token on the request, or "" — the comparison is constant-time either way. */
function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

export async function POST(request: Request): Promise<Response> {
  const expected = engineSecret();
  if (!expected) {
    console.error("engine/publish: ENGINE_SECRET is not set on this deployment");
    return Response.json(
      { code: "server_error", error: "ENGINE_SECRET is not set on this deployment." },
      { status: 500 },
    );
  }
  if (!safeEqual(bearer(request), expected)) {
    return Response.json({ code: "unauthorized", error: "Bad engine secret." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ code: "invalid_body", error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        code: "invalid_body",
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }

  const { workflowId, orgId, userId, publish } = parsed.data;

  try {
    const result = await applyPublish({
      workflowId,
      orgId,
      userId,
      // Clerk is the source of truth for billing and this caller has no session, so the interval is
      // judged against the plan the Backend API reports (cached 60 s per org).
      plan: await getOrgPlan(orgId),
      publish,
    });

    if (!result.ok) {
      return Response.json(
        { code: result.code, error: result.error },
        { status: PUBLISH_ERROR_STATUS[result.code] },
      );
    }

    return Response.json(
      { status: result.status, scheduled: result.scheduled, nextAt: result.nextAt },
      { status: 200 },
    );
  } catch (cause) {
    console.error("engine/publish: could not publish the workflow", cause);
    return Response.json(
      { code: "publish_failed", error: safeErrorMessage(cause) },
      { status: 500 },
    );
  }
}
