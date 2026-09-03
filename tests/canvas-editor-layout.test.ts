import { describe, expect, it } from "vitest";

import {
  CONFIG_PANEL_OVERLAY_WIDTH,
  initialPaletteCollapsed,
  PALETTE_COLLAPSE_WIDTH,
} from "@/components/canvas/editor-layout";

describe("initialPaletteCollapsed", () => {
  it("folds the palette on a narrow window nobody has expressed a preference on", () => {
    expect(initialPaletteCollapsed(800, null)).toBe(true);
    expect(initialPaletteCollapsed(PALETTE_COLLAPSE_WIDTH - 1, null)).toBe(true);
  });

  it("leaves it open when there is room for all three columns", () => {
    expect(initialPaletteCollapsed(PALETTE_COLLAPSE_WIDTH, null)).toBe(false);
    expect(initialPaletteCollapsed(1600, null)).toBe(false);
  });

  it("lets a stored preference win in both directions", () => {
    // Folded it on a wide screen: it stays folded.
    expect(initialPaletteCollapsed(1600, "1")).toBe(true);
    // Opened it on a narrow one: it stays open.
    expect(initialPaletteCollapsed(800, "0")).toBe(false);
  });

  it("treats an unreadable stored value as no preference at all", () => {
    expect(initialPaletteCollapsed(800, "yes")).toBe(true);
    expect(initialPaletteCollapsed(1600, "")).toBe(false);
    expect(initialPaletteCollapsed(Number.NaN, null)).toBe(false);
  });

  it("keeps the two breakpoints in the order the layout depends on", () => {
    // The settings panel starts overlaying below the width at which the palette folds — otherwise
    // there would be a window size with three inline columns and no room for the canvas.
    expect(CONFIG_PANEL_OVERLAY_WIDTH).toBeLessThan(PALETTE_COLLAPSE_WIDTH);
  });
});
