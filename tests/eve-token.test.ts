import { jwtHmac } from "eve/channels/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENGINE_TOKEN_AUDIENCE,
  ENGINE_TOKEN_ISSUER,
  ENGINE_TOKEN_TTL_SECONDS,
  mintEngineToken,
  runtimeAgentHost,
} from "@/lib/eve";

/**
 * The engine's bearer token, checked against the verifier that will actually see it.
 *
 * `agents/runtime/channels/eve.ts` hands eve's own `jwtHmac()` to `eveChannel`, so the only
 * meaningful test of `mintEngineToken` is to build the same authenticator and run it over a real
 * `Request` — that covers the base64url encoding, the HMAC key derivation (eve uses the UTF-8 bytes
 * of `ENGINE_SECRET`), the `sub` requirement, the issuer/audience match and the claim projection in
 * one go. A hand-rolled JWT decoder here would only test itself.
 */

const SECRET = "engine-secret-for-tests";

/** The same authenticator the Runtime agent's channel installs. */
function engineAuth(secret = SECRET) {
  return jwtHmac({
    algorithm: "HS256",
    issuer: ENGINE_TOKEN_ISSUER,
    audiences: [ENGINE_TOKEN_AUDIENCE],
    secret,
  });
}

function bearer(token: string): Request {
  return new Request("https://papaflow.test/eve/agents/runtime/eve/v1/session", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("mintEngineToken", () => {
  beforeEach(() => {
    process.env.ENGINE_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.ENGINE_SECRET;
    delete process.env.APP_ORIGIN;
    vi.useRealTimers();
  });

  it("is accepted by eve's jwtHmac and projects its claims onto the session principal", async () => {
    const token = await mintEngineToken({
      orgId: "org_abc",
      plan: "pro",
      executionId: "exec_123",
      modelConnectionId: "conn_1",
      modelId: "gpt-5.6-luna",
    });

    const auth = await engineAuth()(bearer(token));
    expect(auth).toBeTruthy();

    // `jwtHmac` tags every caller it admits as a service, with `${iss}:${sub}` as the principal.
    expect(auth?.principalType).toBe("service");
    expect(auth?.authenticator).toBe("jwt-hmac");
    expect(auth?.principalId).toBe(`${ENGINE_TOKEN_ISSUER}:org_abc`);
    expect(auth?.subject).toBe("org_abc");

    // The attributes are what the dynamic tool resolver and the model handler read.
    expect(auth?.attributes).toEqual({
      orgId: "org_abc",
      plan: "pro",
      executionId: "exec_123",
      modelConnectionId: "conn_1",
      modelId: "gpt-5.6-luna",
    });
  });

  it("omits the model claims when the node did not choose a connection", async () => {
    const token = await mintEngineToken({ orgId: "org_abc", plan: "free_org", executionId: "e1" });

    const auth = await engineAuth()(bearer(token));
    expect(auth?.attributes).toEqual({ orgId: "org_abc", plan: "free_org", executionId: "e1" });
  });

  it("never carries the signing secret in a claim", async () => {
    const token = await mintEngineToken({ orgId: "org_abc", plan: "pro", executionId: "e1" });

    const [, payload] = token.split(".");
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    expect(decoded).not.toContain(SECRET);

    const auth = await engineAuth()(bearer(token));
    expect(Object.values(auth?.attributes ?? {})).not.toContain(SECRET);
  });

  it("is refused by a verifier holding a different secret", async () => {
    const token = await mintEngineToken({ orgId: "org_abc", plan: "pro", executionId: "e1" });

    await expect(engineAuth("a-different-secret")(bearer(token))).resolves.toBeNull();
  });

  it("is refused once its five minutes are up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));
    const token = await mintEngineToken({ orgId: "org_abc", plan: "pro", executionId: "e1" });

    // Still good a minute in...
    vi.setSystemTime(new Date("2026-09-03T12:01:00Z"));
    expect(await engineAuth()(bearer(token))).toBeTruthy();

    // ...and dead well past `exp` plus eve's 30-second default clock tolerance.
    vi.setSystemTime(new Date(Date.parse("2026-09-03T12:00:00Z") + (ENGINE_TOKEN_TTL_SECONDS + 120) * 1000));
    expect(await engineAuth()(bearer(token))).toBeNull();
  });

  it("refuses to mint anything without ENGINE_SECRET", async () => {
    delete process.env.ENGINE_SECRET;

    await expect(
      mintEngineToken({ orgId: "org_abc", plan: "pro", executionId: "e1" }),
    ).rejects.toThrow(/ENGINE_SECRET/);
  });
});

describe("runtimeAgentHost", () => {
  it("points at the agent's mount path under APP_ORIGIN, with no double slash", () => {
    process.env.APP_ORIGIN = "https://papaflow.test/";
    expect(runtimeAgentHost()).toBe("https://papaflow.test/eve/agents/runtime");
  });

  it("falls back to localhost so `pnpm dev` needs no extra configuration", () => {
    delete process.env.APP_ORIGIN;
    expect(runtimeAgentHost()).toBe("http://localhost:3000/eve/agents/runtime");
  });
});
