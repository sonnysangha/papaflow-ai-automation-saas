import { v } from "convex/values";

import { query } from "./_generated/server";
import { currentPlan } from "./lib/plan";

/** JSON cannot carry Infinity — unlimited becomes null on the wire. */
function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** The active organisation's plan, features and limits, read from the Clerk session token. */
export const current = query({
  args: {},
  returns: v.object({
    slug: v.string(),
    features: v.array(v.string()),
    limits: v.object({
      workflows: v.union(v.number(), v.null()),
      runsPerMonth: v.union(v.number(), v.null()),
      members: v.union(v.number(), v.null()),
      minScheduleMinutes: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const plan = await currentPlan(ctx);

    return {
      slug: plan.slug,
      features: [...plan.features],
      limits: {
        workflows: finite(plan.limits.workflows),
        runsPerMonth: finite(plan.limits.runsPerMonth),
        members: finite(plan.limits.members),
        minScheduleMinutes: plan.limits.minScheduleMinutes,
      },
    };
  },
});
