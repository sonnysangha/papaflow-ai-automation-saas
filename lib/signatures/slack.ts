// Slack's request signature, implemented against `docs/research/connectors-chat.md`:
// `X-Slack-Signature` is `v0=` plus the hex HMAC-SHA256, keyed with the app's signing secret, over
// the string `v0:{X-Slack-Request-Timestamp}:{rawBody}` — the version, the timestamp and the body
// joined with colons. Slack's own guidance is to refuse anything more than five minutes old.
//
// The raw body is the *bytes Slack signed*, so the caller must `await request.text()` before
// anything parses it (CLAUDE.md rule 6). Interactivity payloads are form-encoded
// (`payload=<json>`), and re-encoding a parsed `URLSearchParams` would not round-trip.
//
// The signing secret is per connection, not per deployment: this is a SaaS and the Slack app
// belongs to the user's workspace, so it is opened from the connection's sealed secret by the route
// and passed in here.
import { createHmac } from "node:crypto";

import { safeEqual } from "./timing";

/** Why a delivery was refused. The route answers the same way for all of them and never says which. */
export type SlackFailure =
  | "missing_headers"
  | "malformed_timestamp"
  | "missing_secret"
  | "timestamp_out_of_tolerance"
  | "no_matching_signature";

export type SlackVerification = { ok: true } | { ok: false; reason: SlackFailure };

/** Slack's own window: "the timestamp does not differ from local time by more than five minutes". */
const DEFAULT_TOLERANCE_SECONDS = 300;

/** The only signature version Slack has ever sent. Anything else is not something we can check. */
const VERSION = "v0";

export type VerifySlackOptions = {
  /** Injectable clock, so a test can age a signature without waiting five minutes. */
  now?: number;
  toleranceSeconds?: number;
};

/**
 * Whether this delivery really came from the Slack app that holds `signingSecret`.
 *
 * Positional rather than an options bag because every caller has exactly these four things in this
 * order: the bytes, the two headers, and the secret it just opened.
 *
 * @param rawBody exactly the bytes Slack sent, as text — never a re-serialised object.
 * @param timestamp `request.headers.get("x-slack-request-timestamp")`; null when absent.
 * @param signature `request.headers.get("x-slack-signature")`; the `v0=…` form.
 * @param signingSecret the connection's signing secret, opened from the vault by the caller.
 */
export function verifySlack(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string,
  { now = Date.now(), toleranceSeconds = DEFAULT_TOLERANCE_SECONDS }: VerifySlackOptions = {},
): SlackVerification {
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  // An empty stored secret would otherwise sign an empty key and could be forged by anyone.
  if (!signingSecret) return { ok: false, reason: "missing_secret" };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: "malformed_timestamp" };
  // Freshness first: it is the cheap check, and a replayed-but-valid delivery is a different
  // problem from a forged one — the reason says which.
  if (Math.abs(now / 1000 - seconds) > toleranceSeconds) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  // The timestamp is signed as the string Slack sent, not as a number: the HMAC covers the bytes.
  const digest = createHmac("sha256", signingSecret)
    .update(`${VERSION}:${timestamp}:${rawBody}`)
    .digest("hex");

  return safeEqual(signature, `${VERSION}=${digest}`)
    ? { ok: true }
    : { ok: false, reason: "no_matching_signature" };
}
