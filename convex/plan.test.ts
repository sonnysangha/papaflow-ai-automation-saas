import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { FEATURES, PLAN_LIMITS } from "../lib/plans";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ISSUER = "https://x.clerk.accounts.dev";

/** A Clerk v2 session identity as Convex exposes it. */
function identity(overrides: Record<string, unknown> = {}) {
  return { subject: "user_1", issuer: ISSUER, org_id: "org_1", ...overrides };
}

describe("api.plan.current", () => {
  test("reads the plan and features straight off the session-token claims", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(
      identity({ pla: "o:pro", fea: "o:core_connectors,o:ai_builder,u:ignored" }),
    );

    const plan = await asUser.query(api.plan.current, {});

    expect(plan.slug).toBe("pro");
    // Only `o:`-scoped features count, and the scope prefix is stripped.
    expect(plan.features).toEqual(["core_connectors", "ai_builder"]);
    // PLAN_LIMITS.pro.workflows is Infinity, which JSON cannot carry.
    expect(plan.limits.workflows).toBeNull();
    expect(plan.limits.runsPerMonth).toBe(PLAN_LIMITS.pro.runsPerMonth);
    expect(plan.limits.members).toBe(PLAN_LIMITS.pro.members);
    expect(plan.limits.minScheduleMinutes).toBe(PLAN_LIMITS.pro.minScheduleMinutes);
  });

  test("falls back to free_org when the pla claim is missing", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity());

    const plan = await asUser.query(api.plan.current, {});

    expect(plan.slug).toBe("free_org");
    expect(plan.features).toEqual([...FEATURES.free_org]);
    expect(plan.limits.workflows).toBe(PLAN_LIMITS.free_org.workflows);
    expect(plan.limits.members).toBe(PLAN_LIMITS.free_org.members);
  });

  test("falls back to free_org for a plan slug we do not know", async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity(identity({ pla: "o:enterprise" }));

    const plan = await asUser.query(api.plan.current, {});

    expect(plan.slug).toBe("free_org");
    expect(plan.features).toEqual([...FEATURES.free_org]);
  });

  test("throws when unauthenticated or when there is no active organisation", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.plan.current, {})).rejects.toThrow(/unauthenticated/);

    const noOrg = t.withIdentity({ subject: "user_1", issuer: ISSUER });
    await expect(noOrg.query(api.plan.current, {})).rejects.toThrow(/no active organization/);

    // A session-token shortcode that failed to resolve arrives as a literal, not an org id.
    const badOrg = t.withIdentity(identity({ org_id: "{{org.id}}" }));
    await expect(badOrg.query(api.plan.current, {})).rejects.toThrow(/no active organization/);
  });

  test("accepts the nested Clerk v2 `o` claim, as an object or as a JSON string", async () => {
    const t = convexTest(schema, modules);

    const nested = t.withIdentity({
      subject: "user_1",
      issuer: ISSUER,
      o: { id: "org_2", rol: "admin" },
      pla: "o:team",
    });
    expect((await nested.query(api.plan.current, {})).slug).toBe("team");

    const dotted = t.withIdentity({ subject: "user_1", issuer: ISSUER, "o.id": "org_3" });
    expect((await dotted.query(api.plan.current, {})).slug).toBe("free_org");

    const stringified = t.withIdentity({
      subject: "user_1",
      issuer: ISSUER,
      o: JSON.stringify({ id: "org_4", rol: "admin" }),
    });
    expect((await stringified.query(api.plan.current, {})).slug).toBe("free_org");
  });
});
