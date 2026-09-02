import { describe, expect, it } from "vitest";

import { activeNavHref } from "@/components/app/Header";

/**
 * Which nav item lights up. The interesting cases are the nested ones: a canvas belongs to
 * Workflows, and a workflow's own run history belongs to Workflows too — not to the workspace-wide
 * Runs page, which is a different list of a different thing.
 */
describe("activeNavHref", () => {
  it("matches a section exactly", () => {
    expect(activeNavHref("/w")).toBe("/w");
    expect(activeNavHref("/runs")).toBe("/runs");
    expect(activeNavHref("/connections")).toBe("/connections");
    expect(activeNavHref("/settings")).toBe("/settings");
  });

  it("keeps the section lit inside it", () => {
    expect(activeNavHref("/w/abc123")).toBe("/w");
    expect(activeNavHref("/w/abc123/runs")).toBe("/w");
    expect(activeNavHref("/settings/billing")).toBe("/settings");
  });

  it("prefers the longest matching section", () => {
    expect(activeNavHref("/settings/billing", ["/settings", "/settings/billing"])).toBe(
      "/settings/billing",
    );
  });

  it("lights nothing outside the app sections", () => {
    expect(activeNavHref("/")).toBeNull();
    expect(activeNavHref("/pricing")).toBeNull();
    // A sibling route that merely starts with the same characters is not inside the section.
    expect(activeNavHref("/workspaces")).toBeNull();
  });
});
