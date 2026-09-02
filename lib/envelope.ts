// Server only. The `server-only` package is not installed in this workspace, so this comment is the
// guard: nothing in here may be imported from a Client Component or any browser bundle. It reads
// `CREDENTIALS_KEK` and turns ciphertext back into plaintext credentials.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM seal/open for connection secrets (CLAUDE.md rule 2).
 *
 * Split out of `lib/vault.ts` in Phase 10 and deliberately dependency-free: the eve Runtime agent
 * opens credentials inside its tools, and `lib/vault.ts#openFresh` reaches Convex through
 * `lib/engine-client.ts`, which imports `workflows/run-graph.ts`. Pulling `"use workflow"` modules
 * into the eve bundle is neither needed nor safe, so the crypto lives here, with no imports beyond
 * Node's own, and `lib/vault.ts` re-exports every name it used to own.
 *
 * Convex only ever stores the envelope below, and the key never leaves Node: sealing happens in the
 * credential-save route and the OAuth callbacks, opening happens inside a `"use step"` (or an eve
 * tool) right before a provider call. The AAD is `${orgId}:${connectionId}`, so a ciphertext copied
 * onto another row — another org, another connection — fails the GCM tag check instead of
 * decrypting.
 */

/** The stored envelope. `v` versions the format, `keyId` names the KEK so `k2` can be added later. */
export type Sealed = { v: 1; keyId: string; iv: string; tag: string; ct: string };

const ALGORITHM = "aes-256-gcm";
const KEY_ID = "k1";
const IV_BYTES = 12; // 96 bits: the size GCM is specified for, and the only one Node accelerates.
const KEY_BYTES = 32; // AES-256.

/**
 * The key encryption key, read per call rather than at import time so a process that never touches
 * credentials never needs the env var, and so tests can swap it.
 */
function kek(): Buffer {
  const configured = process.env.CREDENTIALS_KEK;
  if (!configured) {
    throw new Error(
      "vault: CREDENTIALS_KEK is not set. It must be 32 random bytes, base64 encoded " +
        "(`openssl rand -base64 32`), and differ per environment.",
    );
  }

  const key = Buffer.from(configured, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `vault: CREDENTIALS_KEK must decode to 32 bytes for AES-256, got ${key.length}. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }

  return key;
}

/** The additional authenticated data that binds a ciphertext to the row it was written for. */
export function aadFor(orgId: string, connectionId: string): string {
  return `${orgId}:${connectionId}`;
}

/** Encrypt a credential blob. A fresh IV per call, so the same secret never seals to the same bytes. */
export function seal(plaintext: Record<string, unknown>, aad: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, kek(), iv);
  // Order matters: setAAD before update, getAuthTag only after final (verified on Node 24).
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);

  return {
    v: 1,
    keyId: KEY_ID,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
}

/**
 * Decrypt a credential blob. Throws when the KEK is wrong, the AAD does not match the row, or a byte
 * of the ciphertext or tag was changed — Node reports all three as
 * "Unsupported state or unable to authenticate data".
 */
export function open(sealed: Sealed, aad: string): Record<string, unknown> {
  const decipher = createDecipheriv(ALGORITHM, kek(), Buffer.from(sealed.iv, "base64"));
  // Order matters: setAAD and setAuthTag both before final.
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ct, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as Record<string, unknown>;
}
