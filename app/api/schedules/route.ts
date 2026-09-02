import { auth } from "@clerk/nextjs/server";
import { getRun, start } from "workflow/api";
import { z } from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import {
  getScheduleForWorkflow,
  getWorkflowForRun,
  setScheduleEnabled,
  setScheduleRunId,
  upsertSchedule,
} from "@/lib/engine-client";
import { planFromClaim } from "@/lib/plans";
import { nextFireTime, validateSchedule } from "@/lib/schedule";
import { parseScheduleInputs, scheduleTriggerNode } from "@/nodes/triggers/schedule";
import { scheduler } from "@/workflows/scheduler";

/**
 * `POST /api/schedules` — the only thing that turns a Schedule trigger on or off.
 *
 * It is a route rather than a Convex mutation because a schedule is two things at once: a row in
 * `schedules`, and a durable Workflow SDK run sleeping until the next occurrence. Only code that
 * can reach both can keep them agreeing, so everything happens here — validate, upsert, `start()`,
 * store the run id; or cancel the run and clear it. A client that could flip `enabled` on its own
 * would be able to leave a paused schedule with a run still firing it.
 *
 * Node runtime, not Edge: it reaches the Workflow SDK's `start()`/`getRun()`.
 *
 * Gating runs in the three layers CLAUDE.md rule 3 asks for. This is the middle one: `has()` for
 * the `schedules` feature, and — for an org without it — the plan's own `minScheduleMinutes` floor,
 * so a free workspace can still run something hourly. Clerk Billing is not enabled yet, so `has()`
 * answers false for everybody and the free path is the one that actually runs today.
 */
export const runtime = "nodejs";

/** The Clerk feature slug that lifts the interval floor. `org:`-prefixed at the `has()` call. */
const SCHEDULES_FEATURE = "schedules";

/**
 * The plan whose `minScheduleMinutes` an entitled org is judged against. `pro` and `team` are both
 * one minute (`lib/plans.ts`); naming one of them keeps the floor in `PLAN_LIMITS` rather than
 * scattering a second magic number through the route.
 */
const ENTITLED_PLAN = "pro";

const requestBody = z.object({
  workflowId: z.string().min(1),
  action: z.enum(["enable", "pause"]),
});

/** One node as the stored graph carries it (`v.any()` on the Convex side). */
type StoredNodeShape = { data?: { nodeType?: unknown; inputs?: unknown } | null } | null;

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status });
}

/** Field names and reasons only — zod does not put the offending value in its messages. */
function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

/**
 * True when Convex refused the argument rather than the request: a `workflowId` that is not even
 * shaped like an id never names a workflow, so the route answers 404 instead of leaking a 500.
 */
function isMalformedId(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /ArgumentValidationError|Validator error|Invalid argument/i.test(message);
}

/**
 * Cancels a scheduler run, best effort. A run that has already finished, been cancelled, or been
 * garbage-collected is not a failure here: what the caller actually wants is "nothing is firing
 * this schedule any more", and a run that no longer exists satisfies that.
 */
async function cancelSchedulerRun(runId: string, cancelReason: string): Promise<void> {
  try {
    await getRun(runId).cancel({ cancelReason });
  } catch (cause) {
    console.warn(
      `schedules: could not cancel scheduler run ${runId}`,
      cause instanceof Error ? cause.message : cause,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const { isAuthenticated, orgId, sessionClaims, has } = await auth();
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

  let existing: Awaited<ReturnType<typeof getScheduleForWorkflow>>;
  try {
    existing = await getScheduleForWorkflow(workflowId, orgId);
  } catch (cause) {
    if (!isMalformedId(cause)) {
      console.error("schedules: could not read the schedule", cause);
      return json(
        { code: "upstream_error", error: "Could not reach the workflow store. Try again." },
        502,
      );
    }
    // Not even shaped like a workflow id, so it names nothing this org owns.
    return json({ code: "not_found", error: "No such workflow." }, 404);
  }

  if (action === "pause") {
    // Idempotent: a schedule that was never enabled, or has already been paused, is a 200. The
    // canvas' switch can be clicked twice, and a second click must not be an error.
    if (existing === null) return json({ enabled: false, scheduled: false }, 200);

    if (existing.runId) {
      await cancelSchedulerRun(existing.runId, `Schedule paused for workflow ${workflowId}`);
    }
    await setScheduleEnabled({ scheduleId: existing._id, orgId, enabled: false });

    return json({ enabled: false, scheduled: true, scheduleId: existing._id }, 200);
  }

  // Enable. What fires is the *saved* graph, not anything the client sent: an unsaved change to the
  // interval simply is not scheduled yet, which is also what the canvas' "Saved" indicator says.
  const workflow = await getWorkflowForRun(workflowId as Id<"workflows">, orgId);
  if (!workflow) return json({ code: "not_found", error: "No such workflow." }, 404);

  const triggerNode = (workflow.graph.nodes as StoredNodeShape[]).find(
    (node) => node?.data?.nodeType === scheduleTriggerNode.type,
  );
  if (!triggerNode) {
    return json(
      {
        code: "no_schedule_trigger",
        error: "Add a Schedule trigger to this workflow and save before enabling it.",
      },
      400,
    );
  }

  const spec = parseScheduleInputs(triggerNode.data?.inputs);
  if (!spec) {
    return json(
      { code: "invalid_schedule", error: "This Schedule trigger is not configured yet." },
      400,
    );
  }

  const plan = planFromClaim((sessionClaims as { pla?: unknown } | null)?.pla);
  // The feature lifts the floor; without it the org's own plan sets it (`free_org` is 60 minutes).
  const entitled = has({ feature: `org:${SCHEDULES_FEATURE}` });
  const validation = validateSchedule(spec, entitled ? ENTITLED_PLAN : plan);

  if (!validation.ok) {
    // 403 for "your plan will not do that" and 400 for "that is not a schedule" — the switch shows
    // the message either way, and only the first one is worth offering an upgrade for.
    const status = validation.error.code === "too_frequent" ? 403 : 400;
    return json({ code: validation.error.code, error: validation.error.message }, status);
  }

  const { cron, timezone } = validation;

  // Already running exactly this: leave the sleeping run alone. Restarting it would move the next
  // fire time, so clicking "Enable" on an enabled schedule would quietly delay it.
  if (existing?.enabled && existing.runId && existing.cron === cron && existing.timezone === timezone) {
    return json(
      {
        enabled: true,
        unchanged: true,
        scheduleId: existing._id,
        cron,
        timezone,
        nextAt: existing.nextAt ?? null,
        runId: existing.runId,
      },
      200,
    );
  }

  // Anything else — a paused schedule, or an edited cron — is a new run, so the old one goes first.
  if (existing?.runId) {
    await cancelSchedulerRun(existing.runId, `Schedule changed for workflow ${workflowId}`);
  }

  const nextAt = nextFireTime({ mode: "cron", cron, timezone })?.getTime();
  // The row is written before the run is started, because its id is the run's only argument.
  const scheduleId = await upsertSchedule({
    orgId,
    workflowId: workflowId as Id<"workflows">,
    cron,
    timezone,
    enabled: true,
    nextAt,
  });

  const run = await start(
    scheduler,
    [{ scheduleId, cron, timezone }],
    // Plaintext run metadata, filterable in the run inspector. Ids only (CLAUDE.md rule 1).
    { attributes: { scheduleId, orgId } },
  );
  await setScheduleRunId({ scheduleId, orgId, runId: run.runId });

  return json(
    {
      enabled: true,
      unchanged: false,
      scheduleId,
      cron,
      timezone,
      nextAt: nextAt ?? null,
      runId: run.runId,
    },
    200,
  );
}
