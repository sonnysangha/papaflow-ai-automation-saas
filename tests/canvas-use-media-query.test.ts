import { describe, expect, it } from "vitest";

import {
  isMobileWidth,
  MOBILE_BREAKPOINT,
  MOBILE_QUERY,
} from "@/components/canvas/use-media-query";

/**
 * `matchMedia` is what decides at runtime; this is the same rule stated as arithmetic, so the one
 * number the editor's mobile layout hangs off has a test and cannot drift from the query string
 * that is actually evaluated.
 */
describe("the editor's mobile breakpoint", () => {
  it("is Tailwind's `md`, so CSS and markup agree about where the layout changes", () => {
    expect(MOBILE_BREAKPOINT).toBe(768);
  });

  it("writes its query from that number rather than repeating it", () => {
    expect(MOBILE_QUERY).toBe("(max-width: 767px)");
    expect(MOBILE_QUERY).toContain(String(MOBILE_BREAKPOINT - 1));
  });

  it("calls every phone width mobile", () => {
    // 320px is the narrowest viewport the layout is checked at; 390 is an iPhone.
    expect(isMobileWidth(320)).toBe(true);
    expect(isMobileWidth(390)).toBe(true);
    expect(isMobileWidth(MOBILE_BREAKPOINT - 1)).toBe(true);
  });

  it("stops exactly at the breakpoint, where the desktop layout starts", () => {
    // 768 is a tablet in portrait: three columns fit, so it keeps the desktop toolbar.
    expect(isMobileWidth(MOBILE_BREAKPOINT)).toBe(false);
    expect(isMobileWidth(1440)).toBe(false);
  });

  it("treats a width it cannot read as not mobile — the same answer the server gives", () => {
    expect(isMobileWidth(Number.NaN)).toBe(false);
    expect(isMobileWidth(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
