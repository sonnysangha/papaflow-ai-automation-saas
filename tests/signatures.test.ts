import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyStripe } from "@/lib/signatures/stripe";
import { verifyTelegram } from "@/lib/signatures/telegram";
import { safeEqual } from "@/lib/signatures/timing";

/**
 * Signature verification is the only code in the app a stranger can call at will, so every case
 * here is built from a signature computed with Node crypto rather than a fixture: a test that
 * hardcoded a digest would keep passing if the signed payload silently changed shape.
 */

const SECRET = "whsec_test_ZmFrZS1zaWduaW5nLXNlY3JldA";
const RAW_BODY = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } });
const NOW = 1_756_800_000_000; // fixed clock: 2025-09-02T08:00:00Z, in ms
const T = Math.floor(NOW / 1000);

/** Exactly what Stripe does: HMAC-SHA256 hex over `${t}.${rawBody}`, keyed with the whsec_. */
function sign(timestamp: number | string, body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function header(timestamp: number | string, body: string, secret = SECRET): string {
  return `t=${timestamp},v1=${sign(timestamp, body, secret)}`;
}

describe("safeEqual", () => {
  it("accepts identical strings", () => {
    expect(safeEqual("a1b2c3", "a1b2c3")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
  });

  it("rejects same-length strings that differ, including in the last byte only", () => {
    expect(safeEqual("a1b2c3", "a1b2c4")).toBe(false);
    expect(safeEqual("a1b2c3", "b1b2c3")).toBe(false);
  });

  it("rejects different lengths instead of throwing the way timingSafeEqual does", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcd", "")).toBe(false);
  });
});

describe("verifyStripe", () => {
  it("accepts a signature computed over `${t}.${rawBody}`", () => {
    expect(verifyStripe({ rawBody: RAW_BODY, header: header(T, RAW_BODY), secret: SECRET, now: NOW })).toEqual({
      ok: true,
    });
  });

  it("rejects a body tampered with after signing", () => {
    const signed = header(T, RAW_BODY);
    const tampered = RAW_BODY.replace("pi_1", "pi_2");

    expect(verifyStripe({ rawBody: tampered, header: signed, secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a signature made with a different signing secret", () => {
    const other = header(T, RAW_BODY, "whsec_someone_elses_endpoint");

    expect(verifyStripe({ rawBody: RAW_BODY, header: other, secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a replay older than the tolerance and accepts one inside it", () => {
    const old = T - 301;
    expect(verifyStripe({ rawBody: RAW_BODY, header: header(old, RAW_BODY), secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "timestamp_out_of_tolerance",
    });

    const recent = T - 299;
    expect(verifyStripe({ rawBody: RAW_BODY, header: header(recent, RAW_BODY), secret: SECRET, now: NOW })).toEqual({
      ok: true,
    });
  });

  it("rejects a timestamp too far in the future and honours a custom tolerance", () => {
    const ahead = T + 600;
    expect(verifyStripe({ rawBody: RAW_BODY, header: header(ahead, RAW_BODY), secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "timestamp_out_of_tolerance",
    });

    expect(
      verifyStripe({
        rawBody: RAW_BODY,
        header: header(ahead, RAW_BODY),
        secret: SECRET,
        toleranceSeconds: 900,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts when any one of several v1 values matches, and ignores other schemes", () => {
    const rolled = `t=${T},v0=${"0".repeat(64)},v1=${"f".repeat(64)},v1=${sign(T, RAW_BODY)}`;

    expect(verifyStripe({ rawBody: RAW_BODY, header: rolled, secret: SECRET, now: NOW })).toEqual({ ok: true });
  });

  it("rejects when every v1 is wrong even though the header is well formed", () => {
    const rolled = `t=${T},v1=${"f".repeat(64)},v1=${"e".repeat(64)}`;

    expect(verifyStripe({ rawBody: RAW_BODY, header: rolled, secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("signs the timestamp exactly as sent, so a padded t is not silently normalised", () => {
    const padded = ` t=${T} , v1=${sign(T, RAW_BODY)} `;
    expect(verifyStripe({ rawBody: RAW_BODY, header: padded, secret: SECRET, now: NOW })).toEqual({ ok: true });
  });

  it("names each way a header can be unusable", () => {
    const cases: [string | null, string][] = [
      [null, "missing_header"],
      ["", "missing_header"],
      ["not-a-signature-at-all", "malformed_header"],
      [`v1=${sign(T, RAW_BODY)}`, "malformed_header"],
      [`t=${T}`, "malformed_header"],
      [`t=${T},v0=${sign(T, RAW_BODY)}`, "malformed_header"],
      [`t=${T},v1=`, "malformed_header"],
      [`t=later,v1=${sign(T, RAW_BODY)}`, "malformed_header"],
    ];

    for (const [value, reason] of cases) {
      expect(verifyStripe({ rawBody: RAW_BODY, header: value, secret: SECRET, now: NOW })).toEqual({
        ok: false,
        reason,
      });
    }
  });

  it("refuses to verify anything when the connection has no stored secret", () => {
    expect(verifyStripe({ rawBody: RAW_BODY, header: header(T, RAW_BODY), secret: "", now: NOW })).toEqual({
      ok: false,
      reason: "missing_secret",
    });
  });

  it("defaults the tolerance to Stripe's 300 seconds against the real clock", () => {
    const fresh = Math.floor(Date.now() / 1000);
    expect(verifyStripe({ rawBody: RAW_BODY, header: header(fresh, RAW_BODY), secret: SECRET })).toEqual({ ok: true });

    const stale = fresh - 3600;
    expect(verifyStripe({ rawBody: RAW_BODY, header: header(stale, RAW_BODY), secret: SECRET })).toEqual({
      ok: false,
      reason: "timestamp_out_of_tolerance",
    });
  });
});

describe("verifyTelegram", () => {
  const TOKEN = "Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0";

  it("accepts the header Telegram echoes back", () => {
    expect(verifyTelegram(TOKEN, TOKEN)).toBe(true);
  });

  it("rejects a header that differs", () => {
    expect(verifyTelegram(`${TOKEN.slice(0, -1)}X`, TOKEN)).toBe(false);
    expect(verifyTelegram(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(verifyTelegram(`${TOKEN}extra`, TOKEN)).toBe(false);
  });

  it("rejects a missing or empty header", () => {
    expect(verifyTelegram(null, TOKEN)).toBe(false);
    expect(verifyTelegram("", TOKEN)).toBe(false);
  });

  it("rejects everything when the connection stored no token", () => {
    expect(verifyTelegram("", "")).toBe(false);
    expect(verifyTelegram(TOKEN, "")).toBe(false);
    expect(verifyTelegram(null, "")).toBe(false);
  });
});
