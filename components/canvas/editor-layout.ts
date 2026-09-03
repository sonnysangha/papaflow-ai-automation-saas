/**
 * Where the editor's three columns stand before anyone has touched them.
 *
 * The canvas is the point of this page, and it is the column that loses when the other two are
 * open: palette, canvas and settings panel are 288 + 360 px of chrome around it. On a laptop that
 * is fine; on a narrow window the canvas is what is left, so the palette starts folded and the
 * settings panel stops taking width and overlays instead. Both thresholds live here, as numbers a
 * test can read, rather than as Tailwind breakpoints scattered through the markup.
 */

/**
 * Below this the palette is folded away by default: under ~1100px the canvas column would be
 * narrower than the two panels beside it, which is the wrong thing to show first on a page whose
 * job is a graph.
 */
export const PALETTE_COLLAPSE_WIDTH = 1100;

/**
 * Below this the settings panel overlays the canvas from the right instead of squeezing it. The
 * matching CSS is the `max-[899px]:` variants on the panel — one pixel under this number.
 */
export const CONFIG_PANEL_OVERLAY_WIDTH = 900;

/**
 * Is the node palette folded when this editor first draws?
 *
 * A stored preference always wins, in both directions: someone who folded the palette on a wide
 * screen keeps it folded, and someone who opened it on a narrow one keeps it open. The viewport is
 * only consulted when there is nothing stored — a first visit — so this never fights a choice the
 * user actually made.
 *
 * @param width  Viewport width in CSS pixels (`window.innerWidth`).
 * @param stored The raw `papaflow:nodes-collapsed` value, or null when nothing is stored.
 */
export function initialPaletteCollapsed(width: number, stored: string | null): boolean {
  if (stored === "1") return true;
  if (stored === "0") return false;
  // Anything else stored is not a preference — an old value, or a hand-edited one. Treat it the
  // same as nothing at all rather than guessing which way it meant.
  return Number.isFinite(width) && width < PALETTE_COLLAPSE_WIDTH;
}
