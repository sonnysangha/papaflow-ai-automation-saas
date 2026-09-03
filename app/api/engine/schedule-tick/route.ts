import { z } from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import { getOrgPlan } from "@/lib/billing";
import { engineSecret, safeErrorMessage } from "@/lib/engine-env";
import { getSchedule, getWorkflowForRun, startRun } from "@/lib/engine-client";
import { nextFireTime } from "@/lib/schedule";
import { safeEqual } from "@/lib/timing";

/**
 * `POST /api/engine/schedule-tick` — the door Convex's alarm clock knocks on.
 *
 * **Why this route exists.** Convex is the alarm clock, this app is the brain: a published schedule
 * is a row plus one durable Convex scheduled job (`convex/schedules.ts`), armed for the next
 * occurrence. When it fires, `internal.schedules.fire` does not decide anything about the workflow
 * itself — it has no Clerk client and cannot call the Workflow SDK's `start()` (that only runs
 * inside the Next build's transformed workflow graph, `lib/engine-client.ts`) — so it POSTs here
 * instead, carrying nothing but the tick's identity, and this route makes every decision: is the
 * schedule still armed, is the workflow still published, what does the plan allow, when does this
 * fire next. `startRun` is the *same* function the Run button's server action and every other
 * trigger call, so a scheduled run counts against the org's quota, gets a trigger step row and a
 * plan snapshot exactly like a manual one.
 *
 * **Authentication.** A bearer token compared with `timingSafeEqual`, against the same
 * `ENGINE_SECRET` every session-less caller already shares with Convex (CLAUDE.md rule 5). `orgId`
 * still travels in the body and is re-checked against the schedule row Convex itself is asking
 * about, so holding the secret is not enough to start a run for an org or workflow the row does not
 * actually belong to.
 *
 * **The response is instructions, not just a status.** `convex/schedules.ts#fire` reads it to decide
 * what happens to the alarm:
 * - **200** `{ started, executionId?, nextAt, reason? }` — record the tick and arm `nextAt` (absent
 *   only when the cron has no future occurrence, which leaves the schedule enabled with nothing
 *   armed). `started: false` with `reason: "run_limit"` is still a 200: the org's monthly quota is
 *   not this schedule's fault, and the chain must keep ticking.
 * - **409** `{ code: "not_published" }` — the workflow is unpublished or the schedule row is off, by
 *   the time this tick actually landed (`fireSchedule:not-published` in the old design's logs). The
 *   schedule should stop firing until a person publishes again; Convex disarms it.
 * - **anything else** — Convex backs off and tries the same tick again, then gives up and re-arms a
 *   fallback a quarter of an hour out.
 *
 * Node runtime: `startRun` reaches `lib/vault.ts` and the Workflow SDK.
 */
export const runtime = "nodejs";

const body = z.object({
  scheduleId: z.string().min(1),
  workflowId: z.string().min(1),
  orgId: z.string().min(1),
  /** The instant this tick was due — not when Convex's job happened to wake, or retry. */
  plannedAt: z.number(),
});

/** The bearer token on the request, or "" — the comparison is constant-time either way. */
function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

export async function POST(request: Request): Promise<Response> {
  const expected = engineSecret();
  if (!expected) {
    console.error("engine/schedule-tick: ENGINE_SECRET is not set on this deployment");
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

  const { scheduleId, workflowId, orgId, plannedAt } = parsed.data;

  try {
    // Re-read fresh rather than trust the tick's own claim: the row can have been disabled, or the
    // workflow unpublished or deleted, in the window between Convex's own check and this request
    // landing. Checked against the body's `workflowId`/`orgId` too, so holding the shared secret is
    // never enough on its own to start a run for a schedule that does not actually match them.
    const schedule = await getSchedule(scheduleId);
    if (
      !schedule ||
      schedule.workflowId !== workflowId ||
      schedule.orgId !== orgId ||
      !schedule.enabled
    ) {
      return Response.json(
        { code: "not_published", error: "This schedule is not running any more." },
        { status: 409 },
      );
    }

    const workflow = await getWorkflowForRun(workflowId as Id<"workflows">, orgId);
    if (!workflow || workflow.status !== "active") {
      return Response.json(
        { code: "not_published", error: "This workflow is not published." },
        { status: 409 },
      );
    }

    // From now, not from `plannedAt`: a tick retried across several backed-off deliveries must still
    // land on the next occurrence that is actually still ahead of it, not one a retry has already
    // passed. The row's own `cron`/`timezone` were already validated against the plan when the
    // schedule was enabled — a tick re-fires exactly what was armed, it does not re-judge the plan.
    const nextAt = nextFireTime(
      { mode: "cron", cron: schedule.cron, timezone: schedule.timezone },
      new Date(),
    )?.getTime();

    try {
      // No session out here, so the plan comes from Clerk's Backend API and is snapshotted onto the
      // execution by `startRun` (CLAUDE.md rule 10).
      const planSlug = await getOrgPlan(orgId);
      const { executionId } = await startRun({
        orgId,
        workflowId: workflowId as Id<"workflows">,
        trigger: {
          type: "schedule",
          // ISO, matching `nodes/triggers/schedule.ts#scheduleTriggerNode`'s declared `firedAt`
          // output (`z.string()`) — a template already reading `{{ trigger.firedAt }}` keeps working.
          payload: { firedAt: new Date(plannedAt).toISOString(), scheduleId },
        },
        planSlug,
      });
      console.log("engine/schedule-tick: started", { scheduleId, workflowId, orgId, executionId });
      return Response.json({ started: true, executionId, nextAt }, { status: 200 });
    } catch (cause) {
      const message = safeErrorMessage(cause);
      // The org is over its monthly quota — not this schedule's fault. Swallowed into a 200 so the
      // chain keeps ticking rather than being torn down over a limit that may lift next month.
      if (/run_limit/i.test(message)) {
        console.log("engine/schedule-tick: run_limit", { scheduleId, workflowId, orgId });
        return Response.json({ started: false, reason: "run_limit", nextAt }, { status: 200 });
      }
      throw cause;
    }
  } catch (cause) {
    // An id Convex rejects before any handler runs (`v.id("schedules")` on a string that is not
    // one) names a row that cannot exist. That is a 404 — which `fire` treats like a 409 and
    // disarms — not a fault worth three retries and a fallback alarm. Convex itself never sends
    // one; only a hand-written probe does.
    if (isArgumentValidationError(cause)) {
      return Response.json(
        { code: "not_found", error: "No such schedule or workflow." },
        { status: 404 },
      );
    }
    console.error("engine/schedule-tick: could not run the tick", cause);
    return Response.json({ code: "tick_failed", error: safeErrorMessage(cause) }, { status: 500 });
  }
}

/** Convex refused an argument before running anything — the row the id names cannot exist. */
function isArgumentValidationError(cause: unknown): boolean {
  return cause instanceof Error && /ArgumentValidationError/.test(cause.message);
}
