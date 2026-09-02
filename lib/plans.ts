// Plan slugs match Clerk exactly: `free_org` is the auto-created default organisation plan;
// `pro` and `team` are created with `clerk config patch` in Phase 11. Features are Clerk feature slugs
// (used as `org:<slug>` in has()/<Show>). Numeric limits live here because Clerk features are booleans.

export const FEATURES = {
  free_org: ["core_connectors"],
  pro: ["core_connectors", "pro_connectors", "ai_agent", "ai_builder", "schedules", "run_history_30d"],
  team: [
    "core_connectors", "pro_connectors", "ai_agent", "ai_builder", "schedules", "run_history_30d",
    "shared_connections", "audit_log", "priority_runs",
  ],
} as const;

export type PlanSlug = keyof typeof FEATURES;
export type FeatureSlug = (typeof FEATURES)[PlanSlug][number];

export const PLAN_LIMITS: Record<PlanSlug, { workflows: number; runsPerMonth: number; members: number; minScheduleMinutes: number }> = {
  free_org: { workflows: 3, runsPerMonth: 100, members: 1, minScheduleMinutes: 60 },
  pro: { workflows: Infinity, runsPerMonth: 5_000, members: 5, minScheduleMinutes: 1 },
  team: { workflows: Infinity, runsPerMonth: 50_000, members: Infinity, minScheduleMinutes: 1 },
};

export const DEFAULT_PLAN: PlanSlug = "free_org";

export function isPlanSlug(slug: string): slug is PlanSlug {
  return slug in FEATURES;
}

export function featuresForPlan(slug: string): readonly string[] {
  return isPlanSlug(slug) ? FEATURES[slug] : FEATURES[DEFAULT_PLAN];
}

export function limitsForPlan(slug: string) {
  return isPlanSlug(slug) ? PLAN_LIMITS[slug] : PLAN_LIMITS[DEFAULT_PLAN];
}

/**
 * The plan a Clerk session token is carrying. `pla` is "<scope>:<slug>" (e.g. "o:pro"); anything
 * missing or unrecognised is the default plan.
 *
 * Server actions and route handlers read it from `auth()`'s `sessionClaims`; Convex reads the same
 * claim in `convex/lib/auth.ts#requireOrg`. Callers with no session at all (the engine, an inbound
 * webhook) ask Clerk instead — `lib/billing.ts#getOrgPlan`.
 */
export function planFromClaim(pla: unknown): PlanSlug {
  if (typeof pla !== "string") return DEFAULT_PLAN;

  const slug = pla.replace(/^o:/, "");
  return isPlanSlug(slug) ? slug : DEFAULT_PLAN;
}
