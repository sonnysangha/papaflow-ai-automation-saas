import { ConvexError, v } from "convex/values";

import { internalMutation } from "./_generated/server";

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
