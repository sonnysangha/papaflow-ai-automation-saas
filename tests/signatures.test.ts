import { createHmac, generateKeyPairSync, sign as signEd25519, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyDiscord } from "@/lib/signatures/discord";
import { verifySlack } from "@/lib/signatures/slack";
import { verifyStripe } from "@/lib/signatures/stripe";
import { verifyTelegram } from "@/lib/signatures/telegram";
import { safeEqual } from "@/lib/signatures/timing";

/**
 * Signature verification is the only code in the app a stranger can call at will, so almost every
 * case here is built from a signature computed with Node crypto rather than a fixture: a test that
 * hardcoded a digest would keep passing if the signed payload silently changed shape.
 *
 * The one deliberate exception is Slack's own published example vector, which pins the *shape* of
 * the signed string (`v0:{ts}:{body}`) that a computed expectation could not catch drifting.
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

describe("verifySlack", () => {
  /**
   * Slack's own published example (docs.slack.dev, "Verifying requests from Slack"): this exact
   * secret, timestamp and body produce this exact signature. It is the one hardcoded digest in this
   * file, and it is here on purpose — a computed expectation would keep passing if the string being
   * signed silently changed from `v0:{ts}:{body}` to something else.
   */
  const DOC_SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
  const DOC_TIMESTAMP = "1531420618";
  const DOC_BODY =
    "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
  const DOC_SIGNATURE = "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503";
  /** The clock the doc vector was signed under, so its five-minute window is open. */
  const DOC_NOW = Number(DOC_TIMESTAMP) * 1000;

  const SIGNING_SECRET = "slack-signing-secret-abcdef0123456789";
  const PAYLOAD = `payload=${encodeURIComponent(JSON.stringify({ type: "block_actions" }))}`;

  /** Exactly what Slack does: `v0=` plus the hex HMAC-SHA256 over `v0:{ts}:{rawBody}`. */
  function slackSignature(timestamp: number | string, body: string, secret = SIGNING_SECRET): string {
    return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  }

  it("accepts Slack's own documented vector", () => {
    expect(
      verifySlack(DOC_BODY, DOC_TIMESTAMP, DOC_SIGNATURE, DOC_SECRET, { now: DOC_NOW }),
    ).toEqual({ ok: true });
  });

  it("rejects that vector under a different signing secret", () => {
    expect(
      verifySlack(DOC_BODY, DOC_TIMESTAMP, DOC_SIGNATURE, "someone-elses-secret", { now: DOC_NOW }),
    ).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("accepts a freshly computed form-encoded interactivity payload", () => {
    expect(
      verifySlack(PAYLOAD, String(T), slackSignature(T, PAYLOAD), SIGNING_SECRET, { now: NOW }),
    ).toEqual({ ok: true });
  });

  it("rejects a body tampered with after signing", () => {
    const signed = slackSignature(T, PAYLOAD);
    const tampered = `${PAYLOAD}&extra=1`;

    expect(verifySlack(tampered, String(T), signed, SIGNING_SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a signature lifted onto a different timestamp", () => {
    const signed = slackSignature(T, PAYLOAD);

    expect(verifySlack(PAYLOAD, String(T - 1), signed, SIGNING_SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a stale timestamp and accepts one inside the five-minute window", () => {
    const stale = T - 301;
    expect(
      verifySlack(PAYLOAD, String(stale), slackSignature(stale, PAYLOAD), SIGNING_SECRET, {
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });

    const recent = T - 3;
    expect(
      verifySlack(PAYLOAD, String(recent), slackSignature(recent, PAYLOAD), SIGNING_SECRET, {
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a timestamp too far in the future, and honours a custom tolerance", () => {
    const ahead = T + 600;
    expect(
      verifySlack(PAYLOAD, String(ahead), slackSignature(ahead, PAYLOAD), SIGNING_SECRET, {
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });

    expect(
      verifySlack(PAYLOAD, String(ahead), slackSignature(ahead, PAYLOAD), SIGNING_SECRET, {
        now: NOW,
        toleranceSeconds: 900,
      }),
    ).toEqual({ ok: true });
  });

  it("names each way the headers can be unusable", () => {
    const signature = slackSignature(T, PAYLOAD);

    expect(verifySlack(PAYLOAD, null, signature, SIGNING_SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    expect(verifySlack(PAYLOAD, String(T), null, SIGNING_SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    expect(verifySlack(PAYLOAD, "later", signature, SIGNING_SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: "malformed_timestamp",
    });
    // A bare hex digest without the `v0=` prefix is not the header Slack sends.
    expect(
      verifySlack(PAYLOAD, String(T), signature.slice(3), SIGNING_SECRET, { now: NOW }),
    ).toEqual({ ok: false, reason: "no_matching_signature" });
  });

  it("refuses to verify anything when the connection has no signing secret", () => {
    expect(verifySlack(PAYLOAD, String(T), slackSignature(T, PAYLOAD), "", { now: NOW })).toEqual({
      ok: false,
      reason: "missing_secret",
    });
  });

  it("defaults the tolerance to five minutes against the real clock", () => {
    const fresh = Math.floor(Date.now() / 1000);
    expect(
      verifySlack(PAYLOAD, String(fresh), slackSignature(fresh, PAYLOAD), SIGNING_SECRET),
    ).toEqual({ ok: true });

    const stale = fresh - 3600;
    expect(
      verifySlack(PAYLOAD, String(stale), slackSignature(stale, PAYLOAD), SIGNING_SECRET),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });
});

describe("verifyDiscord", () => {
  /**
   * A real Ed25519 keypair, generated here rather than fixed: Discord's public key is 32 raw bytes
   * as hex and the signature is over `timestamp + rawBody`, so the only honest way to test the
   * verifier is to sign the same way Discord does and then break it in each direction.
   */
  function keypair(): { publicKeyHex: string; privateKey: KeyObject } {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    // The JWK `x` is the raw 32-byte point, base64url — exactly what the dashboard prints as hex.
    const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
    return {
      publicKeyHex: Buffer.from(jwk.x ?? "", "base64url").toString("hex"),
      privateKey,
    };
  }

  function discordSignature(timestamp: string, body: string, privateKey: KeyObject): string {
    return signEd25519(null, Buffer.from(`${timestamp}${body}`, "utf8"), privateKey).toString("hex");
  }

  const TIMESTAMP = "1756800000";
  const BODY = JSON.stringify({ type: 3, data: { custom_id: "approve:st_1" } });

  it("accepts an interaction signed by the application's own key", () => {
    const { publicKeyHex, privateKey } = keypair();
    expect(publicKeyHex).toHaveLength(64);

    const signature = discordSignature(TIMESTAMP, BODY, privateKey);
    expect(verifyDiscord(BODY, TIMESTAMP, signature, publicKeyHex)).toBe(true);
    // Case does not matter: the dashboard prints lower case, but hex is hex.
    expect(verifyDiscord(BODY, TIMESTAMP, signature.toUpperCase(), publicKeyHex)).toBe(true);
  });

  it("rejects a body tampered with after signing", () => {
    const { publicKeyHex, privateKey } = keypair();
    const signature = discordSignature(TIMESTAMP, BODY, privateKey);
    const tampered = BODY.replace("approve", "reject");

    expect(verifyDiscord(tampered, TIMESTAMP, signature, publicKeyHex)).toBe(false);
  });

  it("rejects a signature lifted onto a different timestamp", () => {
    const { publicKeyHex, privateKey } = keypair();
    const signature = discordSignature(TIMESTAMP, BODY, privateKey);

    expect(verifyDiscord(BODY, "1756800001", signature, publicKeyHex)).toBe(false);
  });

  it("rejects a valid signature made with somebody else's key", () => {
    const mine = keypair();
    const theirs = keypair();
    const signature = discordSignature(TIMESTAMP, BODY, theirs.privateKey);

    expect(verifyDiscord(BODY, TIMESTAMP, signature, mine.publicKeyHex)).toBe(false);
    // …and the same signature is fine against the key that actually made it.
    expect(verifyDiscord(BODY, TIMESTAMP, signature, theirs.publicKeyHex)).toBe(true);
  });

  it("rejects missing, short and non-hex headers rather than throwing", () => {
    const { publicKeyHex, privateKey } = keypair();
    const signature = discordSignature(TIMESTAMP, BODY, privateKey);

    expect(verifyDiscord(BODY, null, signature, publicKeyHex)).toBe(false);
    expect(verifyDiscord(BODY, TIMESTAMP, null, publicKeyHex)).toBe(false);
    expect(verifyDiscord(BODY, TIMESTAMP, "", publicKeyHex)).toBe(false);
    expect(verifyDiscord(BODY, TIMESTAMP, signature.slice(0, -2), publicKeyHex)).toBe(false);
    expect(verifyDiscord(BODY, TIMESTAMP, `zz${signature.slice(2)}`, publicKeyHex)).toBe(false);
  });

  it("rejects everything when the connection stored no usable public key", () => {
    const { privateKey } = keypair();
    const signature = discordSignature(TIMESTAMP, BODY, privateKey);

    expect(verifyDiscord(BODY, TIMESTAMP, signature, "")).toBe(false);
    expect(verifyDiscord(BODY, TIMESTAMP, signature, "not-hex")).toBe(false);
    // Right length, wrong alphabet.
    expect(verifyDiscord(BODY, TIMESTAMP, signature, "z".repeat(64))).toBe(false);
  });
});
