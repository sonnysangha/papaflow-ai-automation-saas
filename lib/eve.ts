import { Client } from "eve/client";

/**
 * How the engine talks to the eve Runtime agent.
 *
 * The Agent node runs inside a `"use step"`, which has no Clerk session and must never forward a
 * user's one, so it authenticates as itself: a five-minute HS256 JWT signed with `ENGINE_SECRET`.
 * `agents/runtime/channels/eve.ts` verifies it with eve's shipped `jwtHmac()`, which projects every
 * non-standard string claim into `ctx.session.auth.current.attributes`
 * (`node_modules/eve/dist/src/channel/auth/token-claims.js`, `createJwtAttributeProjection` strips
 * only `aud/exp/iat/iss/jti/nbf/sub`). That projection is the whole point: `orgId` is what the
 * dynamic tool resolver builds the org's connector tools from, and `modelConnectionId`/`modelId` are
 * what the `step.started` model handler turns into a live BYOK model.
 *
 * Signing uses Web Crypto rather than `node:crypto` on purpose. `nodes/ai/agent.ts` imports this
 * module, `nodes/registry.ts` imports that node, and the canvas imports the registry — so anything
 * reachable from here is reachable from the browser bundle, where a `node:` specifier is a build
 * error. `crypto.subtle` is global in Node 24 (and in the browser, where it is never called).
 *
 * The token is a bearer credential: it is minted per node run, never logged, never returned from a
 * step, and never written to a `steps` row (CLAUDE.md rule 1).
 */

/** Where `withEve({ agents: { runtime } })` mounts the agent. The client appends `/eve/v1/...`. */
export const RUNTIME_AGENT_PATH = "/eve/agents/runtime";

/** `iss` on the engine's token, and the `issuer` the agent's `jwtHmac()` insists on. */
export const ENGINE_TOKEN_ISSUER = "papaflow-engine";

/** `aud` on the engine's token, and the single entry in the agent's `audiences`. */
export const ENGINE_TOKEN_AUDIENCE = "papaflow-runtime";

/** Long enough for one agent turn, short enough that a leaked token is worthless by the time it is. */
export const ENGINE_TOKEN_TTL_SECONDS = 300;

/**
 * The claims the engine asserts about the run it is starting. All strings: `SessionAuthContext`
 * requires `Readonly<Record<string, string | readonly string[]>>`, so a number or a boolean would
 * simply be dropped by eve's projection.
 */
export type EngineTokenClaims = {
  orgId: string;
  plan: string;
  executionId: string;
  /** The org's AI connection the agent should build its model from, when the node picked one. */
  modelConnectionId?: string;
  /** The model id on that connection. Meaningless without `modelConnectionId`. */
  modelId?: string;
};

const encoder = new TextEncoder();

/** base64url of raw bytes, without padding — JWS wants no `=`, `+` or `/`. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

/** The shared secret, read per call so a process that never mints a token never needs it. */
function engineSecret(): string {
  const secret = process.env.ENGINE_SECRET;
  if (!secret) {
    throw new Error("eve: ENGINE_SECRET is not set, so the Agent node cannot authenticate.");
  }
  return secret;
}

/**
 * A bearer token for the Runtime agent.
 *
 * The key material is the UTF-8 bytes of `ENGINE_SECRET`, which is exactly what eve does on the
 * other side (`createSecretKey(Buffer.from(secret, "utf8"))` in `channel/auth/jwt-hmac.js`), and
 * `sub` must be a non-empty string or that verifier refuses the token before it looks at anything
 * else — so the org id is both `sub` and a projected claim.
 */
export async function mintEngineToken(claims: EngineTokenClaims): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: Record<string, string | number> = {
    iss: ENGINE_TOKEN_ISSUER,
    aud: ENGINE_TOKEN_AUDIENCE,
    sub: claims.orgId,
    iat: issuedAt,
    exp: issuedAt + ENGINE_TOKEN_TTL_SECONDS,
    orgId: claims.orgId,
    plan: claims.plan,
    executionId: claims.executionId,
    ...(claims.modelConnectionId ? { modelConnectionId: claims.modelConnectionId } : {}),
    ...(claims.modelId ? { modelId: claims.modelId } : {}),
  };

  const signingInput = `${base64UrlJson({ alg: "HS256", typ: "JWT" })}.${base64UrlJson(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(engineSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

/**
 * Where this deployment serves the Runtime agent. `APP_ORIGIN` is the server-side origin the
 * connectors already register with providers (`lib/connections-server.ts` reads the same variable).
 */
export function runtimeAgentHost(): string {
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return `${origin.replace(/\/+$/, "")}${RUNTIME_AGENT_PATH}`;
}

/**
 * An `eve/client` bound to the Runtime agent and one engine token.
 *
 * `redirect: "manual"` is not optional for a credential-bearing client: without it `fetch` would
 * follow a cross-origin redirect and take the `Authorization` header with it.
 */
export function runtimeClient(token: string): Client {
  return new Client({
    host: runtimeAgentHost(),
    auth: { bearer: token },
    redirect: "manual",
  });
}
