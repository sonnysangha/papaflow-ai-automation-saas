import {
  findVerifiedSlackConnection,
  handleVerifiedSlackDelivery,
  readSlackDelivery,
  slackChallengeResponse,
  slackFailure,
} from "@/lib/slack-events";

/**
 * `POST /api/events/slack` — the Interactivity Request URL every PapaFlow Slack app carries.
 *
 * One URL for the whole deployment, because the manifest that creates a user's Slack app has to
 * name it *before* there is a connection: the app is what produces the bot token a connection is
 * made from, so a per-connection URL can only ever be a placeholder in it (which is exactly what it
 * was — `https://papaflow.example.com/api/events/slack/CONNECTION_ID`).
 *
 * Which connection a delivery belongs to is therefore read out of the delivery. Slack puts the
 * workspace in every one — `team.id` inside the form-encoded interactivity payload, `team_id` on an
 * Events API envelope — and `connections.externalId` indexes it (`connectors/slack.ts` declares
 * `externalIdFrom: "team_id"`). Nothing about that is trusted: it selects candidate rows, and one
 * of *their* signing secrets then has to have signed these exact bytes.
 *
 * Order matters. The raw body is read first and never re-serialised (CLAUDE.md rule 6); the
 * workspace is read from it; the connections are looked up; the signature is verified; only then
 * does anything happen. Slack allows three seconds, and the whole path is two Convex reads, one
 * decrypt and a `resumeHook` that returns as soon as the SDK has the payload.
 *
 * Node runtime: HMAC, the constant-time compare and the vault are `node:crypto`.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // Before anything else: these are the bytes Slack signed.
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? "";

  const delivery = readSlackDelivery(rawBody, contentType);

  // The Events API's URL check is the one delivery with no workspace on it (`{ type, token,
  // challenge }`), so there is no connection to verify it against and nothing to look up. Echoing
  // is safe because that is all it is: the caller's own value handed straight back as JSON, with no
  // state touched and nothing of ours in the answer.
  const challenge = slackChallengeResponse(delivery);
  if (challenge) return challenge;

  // Slack's certificate probe (`ssl_check=1` and a token, nothing else) names no workspace either.
  // The docs say to confirm receipt and otherwise ignore it: an empty 200.
  if (delivery.sslCheck) return new Response(null, { status: 200 });

  if (!delivery.teamId) {
    return slackFailure(400, "unreadable_delivery", "This does not look like a Slack delivery.");
  }

  const match = await findVerifiedSlackConnection({
    rawBody,
    teamId: delivery.teamId,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });

  if (!match.ok) {
    console.warn(`slack: refused a delivery for team ${delivery.teamId} (${match.code})`);
    return slackFailure(match.status, match.code, match.error);
  }

  return await handleVerifiedSlackDelivery({
    delivery,
    orgId: match.connection.orgId,
    source: `connection ${match.connectionId}`,
  });
}
