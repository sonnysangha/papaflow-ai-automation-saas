import { recordWebhookEvent, updateConnectionMeta } from "@/lib/engine-client";
import { fanOut, loadConnection } from "@/lib/inbound";
import { verifyStripe } from "@/lib/signatures/stripe";

/**
 * `POST /api/events/stripe/:connectionId` — one Stripe event destination's deliveries.
 *
 * The raw body is read first and never re-serialised: the `Stripe-Signature` header covers
 * `${t}.${rawBody}` byte for byte, so a `request.json()` here would make every delivery unverifiable
 * (CLAUDE.md rule 6). The signing secret is the connection's own `whsec_…`, which is why the URL
 * carries a connection id: this is a SaaS, and the endpoint belongs to the user's Stripe account,
 * not to the deployment.
 *
 * Stripe retries with the same `event.id`, so a delivery is claimed in `webhookEvents` before it may
 * start anything; a repeat answers 200 having run nothing. And because a signing secret cannot be
 * tested at connect time (`connectors/stripe.ts`), the first delivery that verifies is what flips
 * `meta.verified` — the connection stops calling itself unverified the moment it demonstrably works.
 *
 * Node runtime: HMAC and the constant-time compare are `node:crypto`.
 */
export const runtime = "nodejs";

const TRIGGER_TYPE = "stripe.event";

type RouteContext = { params: Promise<{ connectionId: string }> };

/** The slice of an event this route reads; the whole thing rides along in the payload. */
type StripeEvent = { id?: unknown; type?: unknown; data?: { object?: unknown } | null };

function fail(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

/**
 * Whether a trigger node configured with `inputs.eventTypes` wants this event. Empty (or missing,
 * or not an array — the graph is `v.any()`) means "every event this endpoint receives", which is
 * what the node's default says.
 */
function wantsEvent(inputs: Record<string, unknown>, eventType: string): boolean {
  const types = inputs.eventTypes;
  if (!Array.isArray(types) || types.length === 0) return true;
  return types.includes(eventType);
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { connectionId } = await params;

  // Before anything else: these are the bytes Stripe signed.
  const rawBody = await request.text();

  const connection = await loadConnection(connectionId, "stripe");
  if (!connection) return fail(404, "not_found", "No endpoint is listening at this URL.");

  const signingSecret =
    typeof connection.secret.signingSecret === "string" ? connection.secret.signingSecret : "";
  const verification = verifyStripe({
    rawBody,
    header: request.headers.get("stripe-signature"),
    secret: signingSecret,
  });

  // One answer for a forged signature, a stale timestamp and a header that never parsed: the
  // sender learns that the delivery was refused, not which check refused it.
  if (!verification.ok) {
    console.warn(`stripe: refused a delivery on ${connectionId} (${verification.reason})`);
    return fail(400, "bad_signature", "This delivery could not be verified.");
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return fail(400, "bad_request", "This delivery was not JSON.");
  }

  const eventId = typeof event.id === "string" ? event.id : "";
  const eventType = typeof event.type === "string" ? event.type : "";
  if (!eventId || !eventType) {
    return fail(400, "bad_request", "This delivery was not a Stripe event.");
  }

  // The source is per connection: two orgs' endpoints can legitimately forward the same event id
  // from the same Stripe account, and neither should silence the other.
  const { duplicate } = await recordWebhookEvent({
    source: `stripe:${connectionId}`,
    eventId,
  });
  if (duplicate) return Response.json({ ok: true, duplicate: true });

  // The credential just proved itself, which is the only proof a `whsec_…` can ever offer.
  if (connection.meta.verified !== true) {
    await updateConnectionMeta({
      connectionId,
      orgId: connection.orgId,
      meta: { verified: true },
    }).catch((cause: unknown) => console.error("stripe: could not flag the connection", cause));
  }

  const started = await fanOut({
    orgId: connection.orgId,
    triggerType: TRIGGER_TYPE,
    connectionId,
    trigger: {
      type: "stripe",
      payload: { event, type: eventType, object: event.data?.object ?? null },
    },
    accept: (inputs) => wantsEvent(inputs, eventType),
  });

  return Response.json({ ok: true, started: started.length });
}
