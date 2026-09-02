// Stripe's `Stripe-Signature` scheme, implemented against `docs/research/connectors-data.md`:
// one header line `t=<unix seconds>,v1=<hex>[,v1=<hex>][,v0=<hex>]`, HMAC-SHA256 keyed with the
// endpoint's `whsec_…` over `${t}.${rawBody}`, hex, 300 s tolerance.
//
// The raw body is the *bytes Stripe signed*, so the caller must `await request.text()` before
// anything parses it (CLAUDE.md rule 6). Re-serialising a parsed object changes the signature.
//
// Verified rather than the `stripe` SDK because the whole check is nine lines of Node crypto and
// the signing secret is per connection, not per deployment — there is no client to construct.
import { createHmac } from "node:crypto";

import { safeEqual } from "./timing";

/** Why a delivery was refused. Routes answer 400 for all of them and never say which. */
export type StripeFailure =
  | "missing_header"
  | "malformed_header"
  | "missing_secret"
  | "timestamp_out_of_tolerance"
  | "no_matching_signature";

export type StripeVerification = { ok: true } | { ok: false; reason: StripeFailure };

export type VerifyStripeArgs = {
  /** Exactly the bytes Stripe sent, as text. Never a re-serialised object. */
  rawBody: string;
  /** `request.headers.get("stripe-signature")`. */
  header: string | null;
  /** The connection's `whsec_…`, opened from the vault by the caller. */
  secret: string;
  /** Stripe's own default is 300 s (`DEFAULT_TOLERANCE` in stripe-node). */
  toleranceSeconds?: number;
  /** Injectable clock, so a test can age a signature without waiting five minutes. */
  now?: number;
};

/** `t=…,v1=…,v0=…` → the timestamp and every v1. Schemes other than v1 are ignored, per Stripe. */
function parseHeader(header: string): { timestamp: string | null; signatures: string[] } {
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const scheme = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (scheme === "t" && timestamp === null) timestamp = value;
    else if (scheme === "v1" && value.length > 0) signatures.push(value);
  }

  return { timestamp, signatures };
}

/**
 * Whether this delivery really came from the Stripe endpoint that holds `secret`.
 *
 * The freshness check comes first because it is the cheap one, and because a replayed-but-valid
 * delivery is a different problem from a forged one — the reason says which.
 */
export function verifyStripe({
  rawBody,
  header,
  secret,
  toleranceSeconds = 300,
  now = Date.now(),
}: VerifyStripeArgs): StripeVerification {
  if (!header) return { ok: false, reason: "missing_header" };
  if (!secret) return { ok: false, reason: "missing_secret" };

  const { timestamp, signatures } = parseHeader(header);
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed_header" };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: "malformed_header" };
  if (Math.abs(now / 1000 - seconds) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  // `timestamp` is compared as the string Stripe sent, not as a number: the HMAC covers the bytes.
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const matched = signatures.some((signature) => safeEqual(signature, expected));

  return matched ? { ok: true } : { ok: false, reason: "no_matching_signature" };
}
