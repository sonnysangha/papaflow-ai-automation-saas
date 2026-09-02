import { verifyToken } from "@clerk/backend";
import { extractBearerToken, localDev, type AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import { BUILDER_WORKFLOW_HEADER } from "@/lib/builder-protocol";
import { DEFAULT_PLAN, isPlanSlug } from "@/lib/plans";

/**
 * Who may open a Builder session.
 *
 * Only a person, from a browser, carrying a Clerk session token — there is no engine caller here,
 * so unlike `agents/runtime/channels/eve.ts` this walk has no `jwtHmac()` entry: nothing in a
 * `"use step"` ever talks to the Builder, and an authenticator that admits a machine is one more
 * way in than this agent needs.
 *
 * `routeAuth` walks the array in order: the first entry returning a `SessionAuthContext` wins, a
 * `null`/`undefined` skips to the next, and exhausting it is a 401. `/eve/v1/health` is public and
 * skips the walk; every session route runs it.
 *
 * Four attributes reach the tools, all strings (`SessionAuthContext.attributes` is required and its
 * values must be `string | readonly string[]`):
 *
 * - `orgId`, `userId` — who is editing, from claims Clerk signed;
 * - `plan` — the plan on the token, kept for logging and for the tools' fast path; the gate itself
 *   re-asks Clerk (`lib/billing-engine.ts`), because a token is minted for a minute and a chat
 *   outlives that;
 * - `workflowId` — which canvas this chat is editing, from the panel's own header. Not a
 *   capability: Convex re-checks the workflow against `orgId` on every write. See
 *   `lib/builder-protocol.ts` for why eve's `clientContext` could not carry it.
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

/** Convex document ids are opaque; only the length and alphabet are worth refusing on. */
function workflowIdFrom(request: Request): string {
  const value = request.headers.get(BUILDER_WORKFLOW_HEADER) ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "";
}

/**
 * Browser callers. Returns `null` — not a 401 — on anything unusable, so the walk falls through to
 * `localDev()` under `eve dev` rather than rejecting a request that entry would have admitted.
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
      // Not a Clerk token, or an expired one.
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
      attributes: {
        orgId,
        userId: subject,
        plan: planFrom(claims),
        workflowId: workflowIdFrom(request),
      },
    };
  };
}

export default eveChannel({
  auth: [
    clerkAuth(),
    // Inert outside `eve dev` / `vercel dev`; in production it authenticates nothing, which is what
    // makes an unauthenticated `POST /eve/v1/session` a 401 there and a 202 under `pnpm dev`. It
    // carries no attributes at all, so every tool refuses a `localDev()` session by itself.
    localDev(),
  ],
});
