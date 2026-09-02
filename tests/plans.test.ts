import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN,
  FEATURE_LABELS,
  FEATURES,
  PLAN_LABELS,
  PLAN_LIMITS,
  featureLabel,
  featuresForPlan,
  isPlanSlug,
  limitsForPlan,
  planWithFeature,
  runHistoryDays,
  type PlanSlug,
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

describe("plan presentation helpers", () => {
  it("names every feature a plan can carry", () => {
    // A slug with no label would show up raw in an upgrade card, which is how a feature slug
    // leaks into the product's copy.
    for (const feature of new Set(Object.values(FEATURES).flat())) {
      expect(FEATURE_LABELS[feature]).toBeTruthy();
      expect(featureLabel(feature)).toBe(FEATURE_LABELS[feature]);
    }
    // Unknown slugs are shown as themselves rather than blank.
    expect(featureLabel("something_new")).toBe("something_new");
  });

  it("points an upgrade at the cheapest plan that includes the feature", () => {
    expect(planWithFeature("pro_connectors")).toBe("pro");
    expect(planWithFeature("ai_builder")).toBe("pro");
    // Team-only features send the org to Team.
    expect(planWithFeature("audit_log")).toBe("team");
    expect(planWithFeature("shared_connections")).toBe("team");
    // A feature no plan carries still offers something to buy rather than nothing.
    expect(planWithFeature("not_a_feature")).toBe("pro");
  });

  it("widens the run-history window only for run_history_30d", () => {
    expect(runHistoryDays([])).toBe(7);
    expect(runHistoryDays(FEATURES.free_org)).toBe(7);
    expect(runHistoryDays(FEATURES.pro)).toBe(30);
    expect(runHistoryDays(FEATURES.team)).toBe(30);
    expect(runHistoryDays(["run_history_30d"])).toBe(30);
  });

  it("labels every plan for the settings badge", () => {
    for (const slug of Object.keys(FEATURES)) expect(PLAN_LABELS[slug as PlanSlug]).toBeTruthy();
  });
});
