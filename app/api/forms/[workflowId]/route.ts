import { ConvexError } from "convex/values";
import { z } from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import { getOrgPlan } from "@/lib/billing";
import { getPublicForm, getWorkflowPublic, startRun } from "@/lib/engine-client";
import { allow } from "@/lib/rate-limit";
import { parseFormSpec, type FormField, type FormSpec } from "@/nodes/triggers/form";

/**
 * `POST /api/forms/:workflowId` — where the hosted form at `/f/:workflowId` submits.
 *
 * The endpoint is public by design: anyone with the URL may submit, exactly like the page that
 * posts to it. So the *form's own configuration* is the authority on what a submission may contain
 * — the field list is read back from the workflow and turned into a zod schema here, unknown keys
 * are dropped, and the browser's validation is treated as a convenience rather than a check.
 *
 * The only other guard is a crude one: ten submissions a minute per IP (`lib/rate-limit.ts`), which
 * makes a bored script uninteresting without asking a real visitor to prove anything. Turnstile is
 * the follow-up when this gets abused for real.
 *
 * As with every trigger, the run is enqueued and the answer is a `202` — the visitor's thank-you
 * screen must not wait for a workflow to finish (CLAUDE.md rule 6).
 *
 * Node runtime: `startRun` goes through the Workflow SDK.
 */
export const runtime = "nodejs";

/** Submissions per IP per window. Generous for a human, boring for a script. */
const LIMIT = 10;
const WINDOW_MS = 60_000;

type RouteContext = { params: Promise<{ workflowId: string }> };

const submission = z.object({ values: z.record(z.string(), z.unknown()).default({}) });

function fail(status: number, code: string, error: string, extra?: object): Response {
  return Response.json({ code, error, ...extra }, { status });
}

/**
 * The submitter's IP. Vercel puts the client first in `x-forwarded-for`; everything after it is
 * proxies. `local` covers `next dev` and any request that arrives without the header — one shared
 * bucket rather than an unlimited one.
 */
function ipOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "local";
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

/**
 * What one field accepts once it is known to be present. Formats are checked here (an email has to
 * look like one, a number has to be one, a select has to be one of its own options); "is it there
 * at all" is answered before this, so these schemas never have to describe a missing value.
 *
 * A select with no configured options is a half-finished form, not a closed set: it takes any
 * string rather than refusing every submission.
 */
function fieldSchema(field: FormField): z.ZodType {
  switch (field.type) {
    case "email":
      return z.email("Enter a valid email address.");
    case "number":
      return z.coerce.number("Enter a number.");
    case "select": {
      const options = field.options ?? [];
      return options.length > 0 ? z.enum(options) : z.string();
    }
    default:
      return z.string();
  }
}

/** Every configured field, optional: presence is checked separately so the messages are readable. */
function schemaFor(spec: FormSpec): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const field of spec.fields) shape[field.name] = fieldSchema(field).optional();
  // `z.object` strips what it does not know, so an extra key in the body never reaches the run.
  return z.object(shape);
}

/** `""` means "not filled in", for both the required check and the format check. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

/**
 * Validates a submission against the form's own configuration.
 *
 * Returns the cleaned values (only configured keys, blanks dropped, numbers coerced) or one message
 * per offending field — keyed by field name so the page can put each message under its own input.
 */
function validate(
  spec: FormSpec,
  values: Record<string, unknown>,
): { ok: true; values: Record<string, unknown> } | { ok: false; fields: Record<string, string> } {
  const filled: Record<string, unknown> = {};
  const fields: Record<string, string> = {};

  for (const field of spec.fields) {
    const value = values[field.name];
    if (present(value)) filled[field.name] = value;
    else if (field.required) fields[field.name] = `${field.label} is required.`;
  }

  const parsed = schemaFor(spec).safeParse(filled);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0] ?? "");
      if (name && !fields[name]) fields[name] = issue.message;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, values: (parsed.success ? parsed.data : filled) as Record<string, unknown> };
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { workflowId } = await params;

  if (!allow(`form:${ipOf(request)}`, LIMIT, WINDOW_MS)) {
    return fail(429, "rate_limited", "Too many submissions. Please try again in a minute.");
  }

  let form: Awaited<ReturnType<typeof getPublicForm>>;
  try {
    form = await getPublicForm(workflowId);
  } catch (cause) {
    if (!isMalformedId(cause)) {
      console.error("form: could not load the form", cause);
      return fail(502, "upstream_error", "Could not reach the workflow store. Try again.");
    }
    form = null;
  }

  // One answer for "no such workflow" and "that workflow has no form": this endpoint must not tell
  // a stranger which workflow ids exist.
  const spec = form ? parseFormSpec(form.form) : null;
  if (!spec) return fail(404, "not_found", "No form is published at this URL.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const parsedBody = submission.safeParse(body);
  if (!parsedBody.success) return fail(400, "invalid_body", "Expected { values }.");

  const checked = validate(spec, parsedBody.data.values);
  if (!checked.ok) {
    const summary = Object.entries(checked.fields)
      .map(([name, message]) => `${name}: ${message}`)
      .join("; ");
    return fail(400, "invalid_values", summary, { fields: checked.fields });
  }

  const workflow = await getWorkflowPublic(workflowId);
  if (!workflow) return fail(404, "not_found", "No form is published at this URL.");

  try {
    await startRun({
      orgId: workflow.orgId,
      workflowId: workflowId as Id<"workflows">,
      trigger: {
        type: "form",
        payload: { values: checked.values, submittedAt: Date.now() },
      },
      planSlug: await getOrgPlan(workflow.orgId),
    });
    return Response.json({ ok: true }, { status: 202 });
  } catch (cause) {
    // The org is out of runs for the month: a real answer, and one the visitor cannot fix.
    if (convexErrorCode(cause) === "run_limit") {
      return fail(429, "run_limit", "This form is not accepting submissions right now.");
    }
    console.error("form: could not start the run", cause);
    return fail(500, "run_failed", "Could not submit this form.");
  }
}
