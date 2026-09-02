import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN,
  FEATURES,
  PLAN_LIMITS,
  featuresForPlan,
  isPlanSlug,
  limitsForPlan,
} from "@/lib/plans";

describe("plans", () => {
  it("exposes the Clerk plan slugs", () => {
    expect(Object.keys(FEATURES).sort()).toEqual(["free_org", "pro", "team"]);
    expect(DEFAULT_PLAN).toBe("free_org");
    expect(isPlanSlug("pro")).toBe(true);
    expect(isPlanSlug("enterprise")).toBe(false);
  });

  it("gives pro the ai_builder feature", () => {
    expect(featuresForPlan("pro")).toContain("ai_builder");
    expect(featuresForPlan("free_org")).not.toContain("ai_builder");
    expect(featuresForPlan("team")).toContain("ai_builder");
  });

  it("falls back to free_org for an unknown slug", () => {
    expect(featuresForPlan("does_not_exist")).toEqual(FEATURES.free_org);
    expect(limitsForPlan("does_not_exist")).toEqual(PLAN_LIMITS.free_org);
  });

  it("caps free_org at three workflows", () => {
    expect(limitsForPlan("free_org").workflows).toBe(3);
    expect(limitsForPlan("pro").workflows).toBe(Infinity);
    expect(limitsForPlan("free_org").minScheduleMinutes).toBe(60);
  });

  it("gives every plan the core_connectors feature", () => {
    for (const slug of Object.keys(FEATURES)) {
      expect(featuresForPlan(slug)).toContain("core_connectors");
    }
  });
});
