import { verifyToken } from "@clerk/backend";
import {
  extractBearerToken,
  jwtHmac,
  localDev,
  withAuthChallenges,
  type AuthFn,
} from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import { ENGINE_TOKEN_AUDIENCE, ENGINE_TOKEN_ISSUER } from "@/lib/eve";
import { DEFAULT_PLAN, isPlanSlug } from "@/lib/plans";

/**
 * Who may open a session on the Runtime agent.
 *
 * `routeAuth` walks this array in order: the first entry returning a `SessionAuthContext` wins, a
 * `null` or `undefined` skips to the next, and exhausting it is a 401. `/eve/v1/health` is public
 * and skips the walk entirely; every session route runs it.
 *
 * Two kinds of caller, one shape:
 *
 * - **A person**, from a browser, carrying a Clerk session token. Verified with `@clerk/backend`'s
 *   `verifyToken` and admitted as `principalType: "user"`.
 * - **The engine**, from the Agent node's step, carrying a five-minute HS256 token it signed with
 *   `ENGINE_SECRET` (`lib/eve.ts#mintEngineToken`). eve's own `jwtHmac()` verifies it and admits it
 *   as `principalType: "service"`.
 *
 * Both land the same attributes — `orgId`, `plan` — because the dynamic tool resolver reads those
 * and does not care which door the caller came through. `SessionAuthContext.attributes` is required
 * and its values must be strings or string arrays, so a plan slug is stringified, never a boolean.
 *
 * Without this file production would still reject unauthenticated sessions (the default channel is
 * `[vercelOidc(), localDev(), placeholderAuth()]`), but it would reject the engine too.
 */

/** Clerk's session claims, read the way `convex/lib/auth.ts#requireOrg` reads them. */
type ClerkClaims = {
  sub?: unknown;
  iss?: unknown;
  org_id?: unknown;
  o?: unknown;
  pla?: unknown;
};

/** A session-token shortcode can arrive unresolved (`"{{org.id}}"`), so shape is checked. */
function orgIdFrom(claims: ClerkClaims): string | undefined {
  const nested = claims.o as { id?: unknown } | undefined;
  const candidates = [claims.org_id, (claims as Record<string, unknown>)["o.id"], nested?.id];
  return candidates.find(
    (value): value is string => typeof value === "string" && value.startsWith("org_"),
  );
}

/** `pla` is `"<scope>:<slug>"` (e.g. `"o:pro"`); anything unrecognised is the default plan. */
function planFrom(claims: ClerkClaims): string {
  if (typeof claims.pla !== "string") return DEFAULT_PLAN;
  const slug = claims.pla.replace(/^o:/, "");
  return isPlanSlug(slug) ? slug : DEFAULT_PLAN;
}

/**
 * Browser callers. Returns `null` — not a 401 — on anything unusable, so the walk falls through to
 * the engine authenticator rather than rejecting the engine's own token as a bad Clerk one.
 */
function clerkAuth(): AuthFn<Request> {
  return async (request) => {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (!token) return null;

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;

    let claims: ClerkClaims;
    try {
      claims = (await verifyToken(token, { secretKey })) as ClerkClaims;
    } catch {
      // Not a Clerk token (or an expired one). The next entry in the walk gets its turn.
      return null;
    }

    const subject = typeof claims.sub === "string" ? claims.sub : undefined;
    const orgId = orgIdFrom(claims);
    if (!subject || !orgId) return null;

    return {
      authenticator: "clerk",
      issuer: typeof claims.iss === "string" ? claims.iss : undefined,
      principalId: subject,
      principalType: "user",
      subject,
      attributes: { orgId, plan: planFrom(claims) },
    };
  };
}

/**
 * Engine callers, verified with eve's shipped `jwtHmac()`.
 *
 * The verifier is built per request rather than once at module load, because eve *evaluates* this
 * module during `eve build`: reading `ENGINE_SECRET` at the top level turns a missing build-time
 * variable into a failed deployment. Constructing the closure per request costs nothing, and a
 * deployment with no secret rejects every engine token instead of quietly verifying them all
 * against `"undefined"`.
 */
function engineAuth(): AuthFn<Request> {
  return withAuthChallenges(async (request: Request) => {
    const secret = process.env.ENGINE_SECRET;
    if (!secret) {
      console.error("runtime agent: ENGINE_SECRET is not set, so no engine token can be accepted.");
      return null;
    }

    return await jwtHmac({
      algorithm: "HS256",
      issuer: ENGINE_TOKEN_ISSUER,
      audiences: [ENGINE_TOKEN_AUDIENCE],
      secret,
    })(request);
  }, [{ scheme: "Bearer" }]);
}

export default eveChannel({
  auth: [
    clerkAuth(),
    engineAuth(),
    // Inert outside `eve dev` / `vercel dev`; in production it authenticates nothing, which is what
    // makes an unauthenticated `POST /eve/v1/session` a 401 there and a 202 under `pnpm dev`.
    localDev(),
  ],
});
