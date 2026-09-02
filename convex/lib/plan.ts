import { limitsForPlan, type PlanSlug } from "../../lib/plans";
import { requireOrg } from "./auth";

export type CurrentPlan = {
  slug: PlanSlug;
  features: readonly string[];
  limits: ReturnType<typeof limitsForPlan>;
};

/**
 * The active organisation's plan. Derived entirely from the Clerk session-token claims — there is no
 * plan table to read, so this never touches the database.
 */
export async function currentPlan(
  ctx: Parameters<typeof requireOrg>[0],
): Promise<CurrentPlan> {
  const { plan, features } = await requireOrg(ctx);
  return { slug: plan, features, limits: limitsForPlan(plan) };
}
