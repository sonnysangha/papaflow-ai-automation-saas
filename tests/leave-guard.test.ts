import { describe, expect, it } from "vitest";

import { isInternalHref, shouldGuardClick, type LinkClick } from "@/components/canvas/use-leave-guard";

/** The page the editor is on for every case below. */
const HERE = "https://papaflow.test/w/abc123";

/** A plain left click on `href`, which is the only kind that ever gets intercepted. */
function click(href: string | null | undefined, overrides: Partial<LinkClick> = {}): LinkClick {
  return {
    href,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("isInternalHref", () => {
  it("accepts pages of this app", () => {
    expect(isInternalHref("/w", HERE)).toBe(true);
    expect(isInternalHref("/w/abc123/runs", HERE)).toBe(true);
    expect(isInternalHref("runs", HERE)).toBe(true);
    expect(isInternalHref("https://papaflow.test/connections", HERE)).toBe(true);
    // Same page, different place on it. Internal — `shouldGuardClick` is what decides it is not a
    // navigation worth stopping.
    expect(isInternalHref("#nodes", HERE)).toBe(true);
  });

  it("rejects anywhere this app cannot save first", () => {
    expect(isInternalHref("https://slack.com/oauth", HERE)).toBe(false);
    expect(isInternalHref("//evil.test/w", HERE)).toBe(false);
    expect(isInternalHref("mailto:sonny@papaflow.test", HERE)).toBe(false);
    expect(isInternalHref("tel:+441234567890", HERE)).toBe(false);
    expect(isInternalHref("javascript:void(0)", HERE)).toBe(false);
    expect(isInternalHref("blob:https://papaflow.test/9f2", HERE)).toBe(false);
  });

  it("rejects a missing or unparseable href", () => {
    expect(isInternalHref(null, HERE)).toBe(false);
    expect(isInternalHref(undefined, HERE)).toBe(false);
    expect(isInternalHref("", HERE)).toBe(false);
  });
});

describe("shouldGuardClick", () => {
  it("stops a plain left click on an in-app link", () => {
    expect(shouldGuardClick(click("/w"), HERE)).toBe(true);
    expect(shouldGuardClick(click("/w/abc123/runs"), HERE)).toBe(true);
    expect(shouldGuardClick(click("/w", { target: "_self" }), HERE)).toBe(true);
  });

  it("leaves clicks that were never going to move this tab", () => {
    // Every one of these opens somewhere else or does something else entirely, so the canvas is
    // still here afterwards and there is nothing to ask about.
    expect(shouldGuardClick(click("/w", { metaKey: true }), HERE)).toBe(false);
    expect(shouldGuardClick(click("/w", { ctrlKey: true }), HERE)).toBe(false);
    expect(shouldGuardClick(click("/w", { shiftKey: true }), HERE)).toBe(false);
    expect(shouldGuardClick(click("/w", { altKey: true }), HERE)).toBe(false);
    expect(shouldGuardClick(click("/w", { button: 1 }), HERE)).toBe(false);
    expect(shouldGuardClick(click("/w", { button: 2 }), HERE)).toBe(false);
    expect(shouldGuardClick(click("/w", { target: "_blank" }), HERE)).toBe(false);
    expect(shouldGuardClick(click("/export.json", { download: true }), HERE)).toBe(false);
  });

  it("leaves a click something else has already handled", () => {
    expect(shouldGuardClick(click("/w", { defaultPrevented: true }), HERE)).toBe(false);
  });

  it("leaves external links to the browser's own prompt", () => {
    expect(shouldGuardClick(click("https://clerk.com/billing"), HERE)).toBe(false);
    expect(shouldGuardClick(click("mailto:sonny@papaflow.test"), HERE)).toBe(false);
  });

  it("leaves links to the page we are already on", () => {
    expect(shouldGuardClick(click("#nodes"), HERE)).toBe(false);
    expect(shouldGuardClick(click("/w/abc123"), HERE)).toBe(false);
    expect(shouldGuardClick(click(HERE), HERE)).toBe(false);
    // A different query string is a different page as far as the router is concerned.
    expect(shouldGuardClick(click("/w/abc123?panel=runs"), HERE)).toBe(true);
  });
});
