// Server only. The `server-only` package is not installed in this workspace, so this comment is the
// guard: nothing in here may be imported from a Client Component or any browser bundle. It reads
// `CREDENTIALS_KEK` and returns plaintext credentials.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { FatalError } from "workflow";

import { getConnectionSealed } from "@/lib/engine-client";

/**
 * AES-256-GCM seal/open for connection secrets (CLAUDE.md rule 2).
 *
 * Convex only ever stores the envelope below, and the key never leaves Node: sealing happens in the
 * credential-save route and the OAuth callbacks, opening happens inside a `"use step"` right before
 * a provider call. The AAD is `${orgId}:${connectionId}`, so a ciphertext copied onto another row —
 * another org, another connection — fails the GCM tag check instead of decrypting.
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

/** What a step gets back: the opened secret plus the row's non-secret identity. */
export type OpenedConnection = {
  orgId: string;
  provider: string;
  kind: string;
  secret: Record<string, unknown>;
  /** The non-secret half `test()` recorded (verified domains, known chats), for nodes that need it. */
  meta?: Record<string, unknown>;
  status: "active";
};

/**
 * The step-side entry point: read the sealed row, refuse it unless it is usable, and open it.
 *
 * Steps receive a `connectionId`, never a secret — the Workflow SDK records step arguments and
 * return values in the run log (CLAUDE.md rule 1) — so this is where the plaintext appears, and it
 * must not leave the step that called it.
 *
 * A dead connection is a `FatalError`: retrying cannot fix a revoked token, only the user can.
 */
export async function openFresh(connectionId: string): Promise<OpenedConnection> {
  const row = await getConnectionSealed(connectionId);

  if (row.status !== "active") {
    throw new FatalError(
      row.status === "revoked" ? "Connection revoked" : "Connection needs reconnect",
    );
  }

  if (row.expiresAt && row.expiresAt - 60_000 < Date.now()) {
    // Phase 7: proactive refresh — swap the token with the provider, re-seal, patch the row, and
    // use the new secret here. Until then a nearly-expired token is used as-is and the provider's
    // 401 surfaces as a connector error.
  }

  return {
    orgId: row.orgId,
    provider: row.provider,
    kind: row.kind,
    secret: open(row.secret, aadFor(row.orgId, connectionId)),
    meta: (row.meta ?? undefined) as Record<string, unknown> | undefined,
    status: row.status,
  };
}
