import { z } from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import { getOrgPlan } from "@/lib/billing";
import { engineSecret, safeErrorMessage } from "@/lib/engine-env";
import { startRun } from "@/lib/engine-client";
import { safeEqual } from "@/lib/timing";

/**
 * `POST /api/engine/run` — starts a manual run on behalf of a session-less caller that holds
 * `ENGINE_SECRET`. Today that is exactly one caller: the Builder agent's `run_workflow` tool.
 *
 * **Why this route exists at all.** A workflow function is only a workflow once the Workflow SDK's
 * compiler has transformed it, and that transform runs in the *Next* build: `withWorkflow()` wires
 * the loaders and writes the `/.well-known/workflow/*` routes, while `withEve()` writes each agent
 * as its own Vercel Build Output service. The spike measured the consequence — after adding the
 * Builder the SDK still reported two workflows, `run-graph` and `scheduler`, because a workflow
 * inside an agent belongs to that agent's service (`docs/research/eve-spike.md`, Phase 12 addendum
 * item 5). So `start(runGraph, …)` cannot be called from the Builder's bundle: the function would
 * not be a transformed workflow there, and importing `lib/engine-client.ts` to try would drag
 * `runGraph`, every step file and the whole node registry's I/O into the agent — the exact thing
 * `lib/builder-engine.ts` and `lib/connections-engine.ts` exist to avoid.
 *
 * The Builder therefore asks the app to press Run for it, and the app presses the *same* button:
 * `startRun` is the function behind the Run bar's server action, so the plan snapshot, the monthly
 * quota check, the trigger step row and the sample-payload fallback are one code path with one set
 * of rules.
 *
 * **Authentication.** A bearer token compared with `timingSafeEqual`, against the same
 * `ENGINE_SECRET` every session-less caller already shares with Convex (CLAUDE.md rule 5). It is not
 * an authorization: `orgId` travels in the body and Convex re-checks the workflow against it, so a
 * caller holding the secret still cannot run another organisation's workflow by guessing an id.
 *
 * Node runtime: `startRun` reaches `lib/vault.ts` and the Workflow SDK.
 */
export const runtime = "nodejs";

const body = z.object({
  workflowId: z.string().min(1),
  orgId: z.string().min(1),
  /** Recorded as `startedBy` on the execution. Informational — ownership is organisational. */
  userId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.any()).optional(),
});

/** The bearer token on the request, or "" — the comparison is constant-time either way. */
function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

export async function POST(request: Request): Promise<Response> {
  const expected = engineSecret();
  if (!expected) {
    console.error("engine/run: ENGINE_SECRET is not set on this deployment");
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

  try {
    // Clerk is the source of truth for billing and the engine has no session, so the plan is read
    // from the Backend API and snapshotted onto the execution (CLAUDE.md rule 10).
    const planSlug = await getOrgPlan(parsed.data.orgId);

    const run = await startRun({
      orgId: parsed.data.orgId,
      workflowId: parsed.data.workflowId as Id<"workflows">,
      trigger: { type: "manual", payload: parsed.data.payload ?? {} },
      startedBy: parsed.data.userId,
      planSlug,
    });

    return Response.json({ executionId: run.executionId, runId: run.runId }, { status: 200 });
  } catch (cause) {
    console.error("engine/run: could not start the run", cause);
    const message = safeErrorMessage(cause);

    // "workflow not found" is a wrong id or another org's; `run_limit` is the plan's monthly cap.
    // Both are the caller's to act on, and a 4xx is what stops the Builder retrying (its tools read
    // 5xx and 401 as "the backend is unreachable" and end the turn).
    const status = /not found|run_limit|no trigger/i.test(message) ? 400 : 500;
    return Response.json({ code: "run_failed", error: message }, { status });
  }
}
