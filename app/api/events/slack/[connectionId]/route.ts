import { loadConnection } from "@/lib/inbound";
import { verifySlack } from "@/lib/signatures/slack";
import {
  handleVerifiedSlackDelivery,
  readSlackDelivery,
  slackFailure,
  SLACK_PROVIDER,
} from "@/lib/slack-events";

/**
 * `POST /api/events/slack/:connectionId` — the Request URL as it used to be handed out.
 *
 * It is kept, unchanged in behaviour, for every Slack app whose Interactivity settings already
 * point here. New apps get `/api/events/slack` instead (the manifest can name that one, because it
 * does not need an id that only exists after the app has been made), and both run the same code
 * from `lib/slack-events.ts` past the signature check — this file is now only the part that is
 * genuinely different: *which* connection to verify against, which the URL states outright.
 *
 * The raw body is read first and never re-serialised — the signature covers `v0:{ts}:{rawBody}`
 * byte for byte, and an interactivity payload is form-encoded, which `URLSearchParams` would not
 * round-trip (CLAUDE.md rule 6).
 *
 * Node runtime: HMAC, the constant-time compare and the vault are `node:crypto`.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { connectionId } = await params;

  // Before anything else: these are the bytes Slack signed.
  const rawBody = await request.text();

  const connection = await loadConnection(connectionId, SLACK_PROVIDER);
  if (!connection) return slackFailure(404, "not_found", "No Slack app is listening at this URL.");

  const signingSecret =
    typeof connection.secret.signingSecret === "string" ? connection.secret.signingSecret : "";
  if (!signingSecret) {
    // The field is optional at connect time, so this is a real and fixable state rather than an
    // attack: the user connected Slack for sending and has not pasted the signing secret yet.
    return slackFailure(
      400,
      "no_signing_secret",
      "This Slack connection has no signing secret configured.",
    );
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
    return slackFailure(401, "bad_signature", "This delivery could not be verified.");
  }

  return await handleVerifiedSlackDelivery({
    delivery: readSlackDelivery(rawBody, request.headers.get("content-type") ?? ""),
    orgId: connection.orgId,
    source: `connection ${connectionId}`,
  });
}
