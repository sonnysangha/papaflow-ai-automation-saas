import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { planFromClaim } from "@/lib/plans";
import {
  enableSchedule,
  pauseSchedule,
  SCHEDULE_ERROR_STATUS,
  SCHEDULES_FEATURE,
  schedulePlan,
} from "@/lib/schedules-server";

/**
 * `POST /api/schedules` — enable or pause a Schedule trigger directly.
 *
 * Kept for backward compatibility. Publishing is now the switch (`publishWorkflow` in
 * `app/(app)/w/[workflowId]/actions.ts`), and the canvas' Schedule panel only reports status; this
 * route is here for anything already calling it, and it runs the *same* `lib/schedules-server.ts`
 * functions the publish action does, so the two can never disagree about what enabling means.
 *
 * It stays a route rather than a Convex mutation for the reason it always did: a schedule is a row
 * in `schedules` *and* a durable Convex job armed for the next occurrence, and only code that can
 * reach both can keep them agreeing. A client that could flip `enabled` on its own would be able to
 * leave a paused schedule with a job still firing it.
 *
 * Node runtime, not Edge: `lib/schedules-server.ts` reaches Convex through `ConvexHttpClient`.
 *
 * Gating runs in the three layers CLAUDE.md rule 3 asks for. This is the middle one: `has()` for
 * the `schedules` feature, and — for an org without it — the plan's own `minScheduleMinutes` floor,
 * so a free workspace can still run something hourly. Clerk Billing is not enabled yet, so `has()`
 * answers false for everybody and the free path is the one that actually runs today.
 */
export const runtime = "nodejs";

const requestBody = z.object({
  workflowId: z.string().min(1),
  action: z.enum(["enable", "pause"]),
});

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status });
}

/** Field names and reasons only — zod does not put the offending value in its messages. */
function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

export async function POST(request: Request): Promise<Response> {
  const { isAuthenticated, orgId, userId, sessionClaims, has } = await auth();
  if (!isAuthenticated || !orgId) {
    return json(
      { code: "unauthorized", error: "Sign in and select an organisation first." },
      401,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ code: "invalid_body", error: "Expected a JSON body." }, 400);
  }

  const parsed = requestBody.safeParse(raw);
  if (!parsed.success) {
    return json({ code: "invalid_body", error: issueSummary(parsed.error) }, 400);
  }

  const { workflowId, action } = parsed.data;

  if (action === "pause") {
    const result = await pauseSchedule({ workflowId, orgId });
    if (!result.ok) {
      return json({ code: result.code, error: result.error }, SCHEDULE_ERROR_STATUS[result.code]);
    }
    return json(
      { enabled: false, scheduled: result.scheduled, ...(result.scheduleId ? { scheduleId: result.scheduleId } : {}) },
      200,
    );
  }

  const plan = schedulePlan({
    plan: planFromClaim((sessionClaims as { pla?: unknown } | null)?.pla),
    // The feature lifts the floor; without it the org's own plan sets it (`free_org` is 60 minutes).
    entitled: has({ feature: `org:${SCHEDULES_FEATURE}` }),
  });

  const result = await enableSchedule({ workflowId, orgId, userId: userId ?? undefined, plan });
  if (!result.ok) {
    return json({ code: result.code, error: result.error }, SCHEDULE_ERROR_STATUS[result.code]);
  }

  return json(
    {
      enabled: true,
      unchanged: result.unchanged,
      scheduleId: result.scheduleId,
      cron: result.cron,
      timezone: result.timezone,
      nextAt: result.nextAt,
    },
    200,
  );
}
