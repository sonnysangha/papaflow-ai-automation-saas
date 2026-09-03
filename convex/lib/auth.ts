import type { GenericDataModel, GenericQueryCtx } from "convex/server";
import { ConvexError } from "convex/values";

import { DEFAULT_PLAN, featuresForPlan, isPlanSlug, type PlanSlug } from "../../lib/plans";

/**
 * Structural context: works for query, mutation and action ctxs.
 * (In an httpAction `getUserIdentity()` throws rather than returning null.)
 */
type Ctx = { auth: GenericQueryCtx<GenericDataModel>["auth"] };

export type OrgIdentity = {
  userId: string;
  orgId: string;
  role?: string;
  /** Plan slug from the `pla` claim; `free_org` unless Clerk Billing says otherwise. */
  plan: PlanSlug;
  /** Org-scoped feature slugs from the `fea` claim, falling back to the plan's feature list. */
  features: readonly string[];
};

/**
 * Clerk is the source of truth for organisations, roles and billing — nothing is mirrored in Convex.
 * Everything below is read off the session token, defensively: Clerk v2 tokens carry the org under a
 * nested `o` object (`{ id, slg, rol, per, fpm }`) and Convex may expose it as an object, as a JSON
 * string, or flattened to dotted keys (`identity["o.id"]`). A top-level `org_id`/`org_role` custom
 * claim is accepted first. Logs the identity keys once when no org claim resolves.
 */
export async function requireOrg(ctx: Ctx): Promise<OrgIdentity> {
  const id = (await ctx.auth.getUserIdentity()) as Record<string, unknown> | null;
  if (!id) throw new Error("unauthenticated");

  const rawO = id["o"];
  const o = (typeof rawO === "string" ? safeParse(rawO) : rawO) as
    | { id?: string; rol?: string }
    | undefined;

  // An unresolved session-token shortcode arrives as a literal string ("{{org.id}}"), so only
  // accept a value that actually looks like a Clerk org id.
  const orgId = [id["org_id"], id["o.id"], o?.id].find(isOrgId);
  const role = (id["org_role"] ?? id["o.rol"] ?? o?.rol) as string | undefined;

  if (!orgId) {
    console.log("requireOrg: no org claim; identity keys:", JSON.stringify(Object.keys(id)));
    throw new Error("no active organization");
  }

  const plan = planFromClaim(id["pla"]);

  return {
    userId: id.subject as string,
    orgId,
    role,
    plan,
    features: featuresFromClaim(id["fea"]) ?? featuresForPlan(plan),
  };
}

/**
 * The engine's own authentication, for functions that run without a Clerk session.
 *
 * Steps, routes and server actions on Vercel have no user identity to present, so they prove they
 * are the engine with an unguessable argument instead (CLAUDE.md rule 5). Every function that takes
 * a `secret` calls this *first*, then delegates; ownership is still not taken on trust, because
 * `orgId` travels with the call and the handler re-checks it against the row it is about to touch.
 *
 * `convex/engine.ts#guard` is this same check, kept private there; collapse the two when that file
 * is next touched.
 */
export function requireEngineSecret(secret: string): void {
  const expected = process.env.ENGINE_SECRET;
  if (!expected || secret !== expected) throw new ConvexError({ code: "unauthorized" });
}

function isOrgId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("org_");
}

/** `pla` is "<scope>:<slug>", e.g. "o:pro". Unknown or missing slugs mean the default plan. */
function planFromClaim(pla: unknown): PlanSlug {
  if (typeof pla !== "string") return DEFAULT_PLAN;
  const slug = pla.replace(/^o:/, "");
  return isPlanSlug(slug) ? slug : DEFAULT_PLAN;
}

/**
 * `fea` is a comma-separated list of scoped feature slugs, e.g. "o:core_connectors,u:something".
 * Only org-scoped entries apply to a workspace. Returns undefined when the claim is absent so the
 * caller can fall back to the plan's feature list.
 */
function featuresFromClaim(fea: unknown): string[] | undefined {
  if (typeof fea !== "string") return undefined;
  return fea
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("o:"))
    .map((entry) => entry.slice(2))
    .filter((entry) => entry.length > 0);
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
