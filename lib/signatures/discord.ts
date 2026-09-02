// Discord's interaction signature, implemented against `docs/research/connectors-chat.md`:
// Ed25519 over `timestamp + rawBody`, with `X-Signature-Ed25519` (hex) and `X-Signature-Timestamp`,
// checked against the application's Public Key from General Information. A failure must be a 401 —
// Discord periodically posts deliberately invalid signatures to an interactions endpoint and
// removes the URL from the app if they are accepted.
//
// Node's own crypto rather than `discord-interactions` or `tweetnacl`: `crypto.verify(null, …)`
// with an Ed25519 key is the whole check, and it is one fewer dependency inside a route that has
// three seconds to answer.
import { createPublicKey, verify as verifyEd25519, type KeyObject } from "node:crypto";

/**
 * The DER prefix that turns 32 raw Ed25519 bytes into an SPKI SubjectPublicKeyInfo, which is the
 * only shape `createPublicKey` accepts for a bare public key:
 * `SEQUENCE { SEQUENCE { OID 1.3.101.112 } BIT STRING }`. Discord publishes the raw 32 bytes as
 * hex, so the two are concatenated.
 */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** 32 bytes, hex. Discord's dashboard shows exactly this. */
const PUBLIC_KEY_HEX = /^[0-9a-fA-F]{64}$/;
/** 64 bytes, hex — an Ed25519 signature. */
const SIGNATURE_HEX = /^[0-9a-fA-F]{128}$/;

/** The application's public key as a `KeyObject`, or null when it is not 32 hex-encoded bytes. */
function publicKeyFromHex(publicKeyHex: string): KeyObject | null {
  if (!PUBLIC_KEY_HEX.test(publicKeyHex)) return null;

  try {
    return createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
  } catch {
    // A key that is the right length but not a point on the curve. Refused like any other.
    return null;
  }
}

/**
 * Whether this interaction really came from the Discord application that owns `publicKeyHex`.
 *
 * Ed25519 verification is constant-time by construction, so unlike the HMAC verifiers there is
 * nothing here to compare with `safeEqual`.
 *
 * @param rawBody exactly the bytes Discord sent, as text — never a re-serialised object.
 * @param timestamp `request.headers.get("x-signature-timestamp")`; null when absent.
 * @param signatureHex `request.headers.get("x-signature-ed25519")`; null when absent.
 * @param publicKeyHex the connection's `meta.publicKey` — public information, not a secret.
 */
export function verifyDiscord(
  rawBody: string,
  timestamp: string | null,
  signatureHex: string | null,
  publicKeyHex: string,
): boolean {
  if (!timestamp || !signatureHex) return false;
  if (!SIGNATURE_HEX.test(signatureHex)) return false;

  const key = publicKeyFromHex(publicKeyHex);
  if (!key) return false;

  try {
    // `null` as the algorithm: Ed25519 hashes internally and rejects a digest name.
    return verifyEd25519(
      null,
      Buffer.from(`${timestamp}${rawBody}`, "utf8"),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}
