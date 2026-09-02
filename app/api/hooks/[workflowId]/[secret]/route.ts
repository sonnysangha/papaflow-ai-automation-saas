import { ConvexError } from "convex/values";

import type { Id } from "@/convex/_generated/dataModel";
import { getOrgPlan } from "@/lib/billing";
import { getWorkflowPublic, startRun } from "@/lib/engine-client";
import { safeEqual } from "@/lib/timing";

/**
 * `GET|POST /api/hooks/:workflowId/:secret` — the Webhook trigger.
 *
 * The URL *is* the credential: there is no session, no signature and no shared account, so the
 * only thing that matters is that the secret segment matches the one stored on the workflow, and
 * that the comparison cannot be walked character by character (`safeEqual`). A wrong secret, an
 * unknown workflow and a malformed id all answer the same 404: this endpoint must not tell a
 * stranger which workflow ids exist.
 *
 * Once the secret is proved, the delivery becomes the trigger payload and the run is enqueued —
 * `startRun` returns as soon as the Workflow SDK has accepted it, so the caller gets its `202`
 * without waiting for a single node to run (CLAUDE.md rule 6).
 *
 * Node runtime: `safeEqual` is `node:crypto`.
 */
export const runtime = "nodejs";

/** Never copied into the payload: a step's output is stored and shown (CLAUDE.md rule 1). */
const DROPPED_HEADERS: ReadonlySet<string> = new Set(["authorization", "cookie"]);

type RouteContext = { params: Promise<{ workflowId: string; secret: string }> };

/** What the `webhook.trigger` node advertises as its output — see `nodes/triggers/webhook.ts`. */
type WebhookPayload = {
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
};

function fail(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

/** Lower-cased header names (HTTP is case-insensitive; templates are not), minus the secrets. */
function headersOf(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (!DROPPED_HEADERS.has(name)) headers[name] = value;
  });
  return headers;
}

/**
 * JSON when the caller said JSON, the raw text otherwise, `null` when there is no body at all.
 * A body that claims to be JSON but is not stays as text rather than failing the delivery — the
 * workflow author can see exactly what arrived instead of a 400 they cannot debug.
 */
async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return null;

  const text = await request.text();
  if (text.length === 0) return null;
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("json")) return text;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A `v.id()` validator refusing a string that is not shaped like an id — a 404, not an outage. */
function isMalformedId(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /ArgumentValidationError|Validator error|Invalid argument/i.test(message);
}

/** The `ConvexError({ code, … })` payload, or null for a transport or unexpected error. */
function convexErrorCode(cause: unknown): string | null {
  if (!(cause instanceof ConvexError)) return null;
  const data: unknown = cause.data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

async function handle(request: Request, { params }: RouteContext): Promise<Response> {
  const { workflowId, secret } = await params;

  let workflow: Awaited<ReturnType<typeof getWorkflowPublic>>;
  try {
    workflow = await getWorkflowPublic(workflowId);
  } catch (cause) {
    if (!isMalformedId(cause)) {
      console.error("webhook: could not load the workflow", cause);
      return fail(502, "upstream_error", "Could not reach the workflow store. Try again.");
    }
    workflow = null;
  }

  // One answer for "no such workflow" and "wrong secret", and the compare is constant time.
  if (!workflow || !safeEqual(secret, workflow.webhookSecret)) {
    return fail(404, "not_found", "No webhook is listening at this URL.");
  }

  if (!workflow.hasTrigger.webhook) {
    return fail(400, "no_webhook_trigger", "This workflow does not start with a Webhook trigger.");
  }

  const url = new URL(request.url);
  const payload: WebhookPayload = {
    method: request.method,
    headers: headersOf(request),
    query: Object.fromEntries(url.searchParams),
    body: await readBody(request),
  };

  try {
    const { executionId } = await startRun({
      orgId: workflow.orgId,
      workflowId: workflowId as Id<"workflows">,
      trigger: { type: "webhook", payload },
      planSlug: await getOrgPlan(workflow.orgId),
    });
    return Response.json({ executionId }, { status: 202 });
  } catch (cause) {
    // The org is out of runs for the month: a real answer, and one a sender should not retry into.
    if (convexErrorCode(cause) === "run_limit") {
      return fail(429, "run_limit", "This workspace has used all of its runs for the month.");
    }
    console.error("webhook: could not start the run", cause);
    return fail(500, "run_failed", "Could not start this workflow.");
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return await handle(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return await handle(request, context);
}
