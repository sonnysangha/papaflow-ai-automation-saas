import { resumeByStepId } from "@/lib/hooks";
import { loadConnection } from "@/lib/inbound";
import { verifySlack } from "@/lib/signatures/slack";
import { parseApprovalCallback } from "@/nodes/logic/approval";

/**
 * `POST /api/events/slack/:connectionId` — this Slack app's Interactivity Request URL.
 *
 * The URL is per connection because the credential is: this is a SaaS, the Slack app belongs to the
 * user's workspace, and the signing secret that proves a delivery lives inside *their* connection's
 * sealed secret. The raw body is read first and never re-serialised — the signature covers
 * `v0:{ts}:{rawBody}` byte for byte, and an interactivity payload is form-encoded, which
 * `URLSearchParams` would not round-trip (CLAUDE.md rule 6).
 *
 * Slack gives a Request URL three seconds, so the whole handler is: verify, resolve the button's
 * callback id to a suspended step, resume, answer. `resumeHook` returns as soon as the SDK has the
 * payload; the run carries on without this request.
 *
 * The answer body is a message: Slack replaces the original one with whatever JSON comes back, so
 * pressing Approve visibly turns the buttons into "✅ Approved by …" for everyone in the channel.
 *
 * Node runtime: HMAC, the constant-time compare and the vault are `node:crypto`.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ connectionId: string }> };

/** The slice of a `block_actions` payload this route reads. Everything else is ignored. */
type SlackUser = { username?: unknown; name?: unknown; id?: unknown };
type SlackAction = { value?: unknown; action_id?: unknown };
type SlackPayload = { type?: unknown; user?: SlackUser; actions?: SlackAction[] };

function fail(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

/** Whoever pressed the button, as Slack names them. Never an email or anything else identifying. */
function pressedBy(user: SlackUser | undefined): string {
  for (const value of [user?.username, user?.name, user?.id]) {
    if (typeof value === "string" && value) return value;
  }
  return "someone";
}

/** `payload=<json>` out of the form-encoded body, or null when there is no readable payload. */
function parsePayload(rawBody: string): SlackPayload | null {
  const encoded = new URLSearchParams(rawBody).get("payload");
  if (!encoded) return null;

  try {
    const parsed: unknown = JSON.parse(encoded);
    return typeof parsed === "object" && parsed !== null ? (parsed as SlackPayload) : null;
  } catch {
    return null;
  }
}

/**
 * The Events API's one-time Request URL check, which Slack also runs against an interactivity URL
 * when both point at the same route. JSON in, the challenge back out.
 */
function urlVerification(rawBody: string, contentType: string): Response | null {
  if (!contentType.toLowerCase().includes("json")) return null;

  let body: { type?: unknown; challenge?: unknown };
  try {
    body = JSON.parse(rawBody) as { type?: unknown; challenge?: unknown };
  } catch {
    return null;
  }

  if (body.type !== "url_verification" || typeof body.challenge !== "string") return null;
  return Response.json({ challenge: body.challenge });
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { connectionId } = await params;

  // Before anything else: these are the bytes Slack signed.
  const rawBody = await request.text();

  const connection = await loadConnection(connectionId, "slack");
  if (!connection) return fail(404, "not_found", "No Slack app is listening at this URL.");

  const signingSecret =
    typeof connection.secret.signingSecret === "string" ? connection.secret.signingSecret : "";
  if (!signingSecret) {
    // The field is optional at connect time, so this is a real and fixable state rather than an
    // attack: the user connected Slack for sending and has not pasted the signing secret yet.
    return fail(400, "no_signing_secret", "This Slack connection has no signing secret configured.");
  }

  const verification = verifySlack(
    rawBody,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
    signingSecret,
  );
  // One answer for a forged signature, a stale timestamp and a missing header: the sender learns
  // that the delivery was refused, not which check refused it.
  if (!verification.ok) {
    console.warn(`slack: refused a delivery on ${connectionId} (${verification.reason})`);
    return fail(401, "bad_signature", "This delivery could not be verified.");
  }

  const challenge = urlVerification(rawBody, request.headers.get("content-type") ?? "");
  if (challenge) return challenge;

  const payload = parsePayload(rawBody);
  // Past the signature check, so anything unreadable is Slack sending something this build does not
  // act on. A retry would send the same bytes, so it is accepted rather than refused.
  if (!payload || payload.type !== "block_actions") return Response.json({ ok: true });

  const action = payload.actions?.[0];
  const callback = parseApprovalCallback(action?.value);
  if (!callback) return Response.json({ ok: true });

  const by = pressedBy(payload.user);

  try {
    const resumed = await resumeByStepId(
      callback.stepId,
      {
        approved: callback.approved,
        by,
        provider: "slack",
        // `runGraph` follows a resumed payload's `handle` over the node's own.
        handle: callback.approved ? "approved" : "rejected",
      },
      connection.orgId,
    );

    // 200 either way: a non-2xx shows the presser a red error banner, and "this already happened"
    // is not an error. The body says so instead.
    if (!resumed.ok) {
      return Response.json({
        replace_original: true,
        text: "This approval is no longer waiting — the run has already moved on.",
        error: "not_waiting",
      });
    }

    return Response.json({
      replace_original: true,
      text: callback.approved ? `✅ Approved by ${by}` : `❌ Rejected by ${by}`,
    });
  } catch (cause) {
    console.error("slack: could not resume the run", cause);
    return fail(502, "resume_failed", "The run could not be resumed. Try again.");
  }
}
