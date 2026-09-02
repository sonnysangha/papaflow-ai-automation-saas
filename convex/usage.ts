import { ConvexError, v } from "convex/values";

import { internalMutation, query } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { currentPlan } from "./lib/plan";

/**
 * The `usage.month` key: "YYYY-MM" in UTC. Deliberately not local time — a run at 23:30 in Sydney
 * and one at 08:30 in London on the same UTC day must land in the same bucket.
 */
export function monthKey(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7);
}

/**
 * Counts one run against the org's month and enforces the plan cap in the same transaction, so two
 * runs starting at once cannot both slip past the limit. `limit` is `null` for unlimited plans
 * (`Infinity` in `PLAN_LIMITS`); the caller converts, because JSON on the wire has no Infinity.
 *
 * Throws `ConvexError({ code: "run_limit", limit })` instead of counting when the run would exceed
 * the cap. The caller's whole mutation rolls back with it, so no execution row is left behind.
 */
export const incrementRuns = internalMutation({
  args: { orgId: v.string(), limit: v.union(v.number(), v.null()) },
  returns: v.object({ month: v.string(), runs: v.number() }),
  handler: async (ctx, { orgId, limit }) => {
    const month = monthKey();
    const row = await ctx.db
      .query("usage")
      .withIndex("by_org_month", (q) => q.eq("orgId", orgId).eq("month", month))
      .unique();

    const runs = (row?.runs ?? 0) + 1;
    if (limit !== null && runs > limit) throw new ConvexError({ code: "run_limit", limit });

    if (row) await ctx.db.patch(row._id, { runs });
    else await ctx.db.insert("usage", { orgId, month, runs, builderTurns: 0, houseModelCalls: 0 });

    return { month, runs };
  },
});

/** JSON cannot carry Infinity — an unlimited allowance becomes null on the wire, as in `plan.ts`. */
function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/**
 * What the settings page's usage bars read: this month's runs and the org's workflow count, each
 * against the allowance of the plan on the caller's session token.
 *
 * The counts are the same ones the limits are enforced against — `usage.incrementRuns` counts runs
 * into this row, and `workflows.create` counts the same table — so a bar that reads "3 of 3" is
 * exactly the wall the next create hits.
 */
export const current = query({
  args: {},
  returns: v.object({
    month: v.string(),
    runs: v.number(),
    workflows: v.number(),
    plan: v.string(),
    limits: v.object({
      runsPerMonth: v.union(v.number(), v.null()),
      workflows: v.union(v.number(), v.null()),
    }),
  }),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);
    const { slug, limits } = await currentPlan(ctx);
    const month = monthKey();

    const row = await ctx.db
      .query("usage")
      .withIndex("by_org_month", (q) => q.eq("orgId", orgId).eq("month", month))
      .unique();

    // One indexed read of a table a workspace holds tens of rows in, exactly as `workflows.list`
    // does — the count has to match the one `workflows.create` enforces against.
    const workflows = await ctx.db
      .query("workflows")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return {
      month,
      runs: row?.runs ?? 0,
      workflows: workflows.length,
      plan: slug,
      limits: {
        runsPerMonth: finite(limits.runsPerMonth),
        workflows: finite(limits.workflows),
      },
    };
  },
});
