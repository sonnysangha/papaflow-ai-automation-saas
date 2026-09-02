import { randomBytes } from "node:crypto";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";

import { getConnectionSealed } from "@/lib/engine-client";
import { aadFor, open, openFresh, seal, type Sealed } from "@/lib/vault";

/**
 * The vault is pure Node crypto plus one Convex read, so the only thing worth faking is the read:
 * `@/lib/engine-client` would otherwise drag in the Workflow SDK entrypoint and a live deployment.
 * Everything else here — the cipher, the AAD binding, the KEK checks — is the real code.
 */
vi.mock("@/lib/engine-client", () => ({ getConnectionSealed: vi.fn() }));

const getConnectionSealedMock = vi.mocked(getConnectionSealed);

const ORG = "org_2abc";
const CONNECTION = "j57d0000000000000000000000";
const SECRET = { apiKey: "sk-live-0123456789abcdef", teamId: "T04", nested: { a: 1, b: [1, 2] } };

/** A valid 32-byte base64 KEK, regenerated per run so no fixture key ever ships in the repo. */
let KEK: string;

beforeAll(() => {
  KEK = randomBytes(32).toString("base64");
  process.env.CREDENTIALS_KEK = KEK;
});

beforeEach(() => {
  process.env.CREDENTIALS_KEK = KEK;
  getConnectionSealedMock.mockReset();
});

afterEach(() => {
  process.env.CREDENTIALS_KEK = KEK;
});

/** Flip the first byte of a base64 field, keeping its length so GCM fails on the tag, not the size. */
function tamper(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 0xff;
  return bytes.toString("base64");
}

describe("aadFor", () => {
  it("binds a blob to its org and connection", () => {
    expect(aadFor(ORG, CONNECTION)).toBe(`${ORG}:${CONNECTION}`);
  });
});

describe("seal / open", () => {
  it("round-trips an object", () => {
    const aad = aadFor(ORG, CONNECTION);
    expect(open(seal(SECRET, aad), aad)).toEqual(SECRET);
  });

  it("produces a versioned, keyed envelope with a 12-byte iv and a 16-byte tag", () => {
    const sealed = seal(SECRET, aadFor(ORG, CONNECTION));

    expect(sealed.v).toBe(1);
    expect(sealed.keyId).toBe("k1");
    expect(Buffer.from(sealed.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(sealed.tag, "base64")).toHaveLength(16);
    // The ciphertext is not the plaintext in disguise.
    expect(Buffer.from(sealed.ct, "base64").toString("utf8")).not.toContain("sk-live");
  });

  it("uses a fresh iv per seal, so the same plaintext never yields the same ciphertext", () => {
    const aad = aadFor(ORG, CONNECTION);
    const a = seal(SECRET, aad);
    const b = seal(SECRET, aad);

    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(a.tag).not.toBe(b.tag);
  });

  it("refuses a blob opened with the wrong aad (another org, another connection)", () => {
    const sealed = seal(SECRET, aadFor(ORG, CONNECTION));

    // Verified on Node 24: a wrong AAD fails the tag check, not the parse.
    expect(() => open(sealed, aadFor("org_other", CONNECTION))).toThrow(
      /unable to authenticate data/i,
    );
    expect(() => open(sealed, aadFor(ORG, "j57d0000000000000000000001"))).toThrow();
  });

  it("refuses a tampered tag", () => {
    const sealed = seal(SECRET, aadFor(ORG, CONNECTION));
    const forged: Sealed = { ...sealed, tag: tamper(sealed.tag) };

    expect(() => open(forged, aadFor(ORG, CONNECTION))).toThrow();
  });

  it("refuses a tampered ciphertext", () => {
    const sealed = seal(SECRET, aadFor(ORG, CONNECTION));
    const forged: Sealed = { ...sealed, ct: tamper(sealed.ct) };

    expect(() => open(forged, aadFor(ORG, CONNECTION))).toThrow();
  });
});

describe("the key encryption key", () => {
  it("says so when CREDENTIALS_KEK is missing", () => {
    delete process.env.CREDENTIALS_KEK;

    expect(() => seal(SECRET, aadFor(ORG, CONNECTION))).toThrow(/CREDENTIALS_KEK/);
  });

  it("says so when CREDENTIALS_KEK is the wrong length", () => {
    process.env.CREDENTIALS_KEK = randomBytes(16).toString("base64");

    expect(() => seal(SECRET, aadFor(ORG, CONNECTION))).toThrow(/32 bytes/);
  });

  it("cannot open a blob sealed under a different key", () => {
    const sealed = seal(SECRET, aadFor(ORG, CONNECTION));
    process.env.CREDENTIALS_KEK = randomBytes(32).toString("base64");

    expect(() => open(sealed, aadFor(ORG, CONNECTION))).toThrow();
  });
});

describe("openFresh", () => {
  /** The row shape `engine.getConnectionSealed` returns, sealed for this org/connection pair. */
  function row(status: "active" | "needs_reconnect" | "revoked", expiresAt?: number) {
    return {
      orgId: ORG,
      provider: "openai",
      kind: "apiKey" as const,
      secret: seal(SECRET, aadFor(ORG, CONNECTION)),
      expiresAt,
      status,
    };
  }

  it("returns the decrypted secret and the row's non-secret fields", async () => {
    getConnectionSealedMock.mockResolvedValue(row("active"));

    await expect(openFresh(CONNECTION)).resolves.toEqual({
      orgId: ORG,
      provider: "openai",
      kind: "apiKey",
      secret: SECRET,
      status: "active",
    });
    expect(getConnectionSealedMock).toHaveBeenCalledWith(CONNECTION);
  });

  it("opens a row that is close to expiry (refresh lands in Phase 7)", async () => {
    getConnectionSealedMock.mockResolvedValue(row("active", Date.now() + 5_000));

    await expect(openFresh(CONNECTION)).resolves.toMatchObject({ secret: SECRET });
  });

  it("throws a FatalError when the connection needs reconnecting", async () => {
    getConnectionSealedMock.mockResolvedValue(row("needs_reconnect"));

    await expect(openFresh(CONNECTION)).rejects.toThrow(FatalError);
    await expect(openFresh(CONNECTION)).rejects.toThrow("Connection needs reconnect");
  });

  it("throws a FatalError when the connection was revoked", async () => {
    getConnectionSealedMock.mockResolvedValue(row("revoked"));

    await expect(openFresh(CONNECTION)).rejects.toThrow(FatalError);
    await expect(openFresh(CONNECTION)).rejects.toThrow("Connection revoked");
  });

  it("refuses a blob that belongs to another connection", async () => {
    getConnectionSealedMock.mockResolvedValue({
      ...row("active"),
      secret: seal(SECRET, aadFor(ORG, "j57d0000000000000000000009")),
    });

    await expect(openFresh(CONNECTION)).rejects.toThrow();
  });
});
