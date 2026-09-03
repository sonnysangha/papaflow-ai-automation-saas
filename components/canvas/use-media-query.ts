"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * "Is this a phone?" for the editor, as one number and one query.
 *
 * The canvas rearranges itself below `md` — the palette becomes a bottom sheet, the toolbar becomes
 * two rows, the settings panel becomes a sheet over the flow — and most of that is done in CSS with
 * `max-md:` variants. This hook is for the handful of places where the *markup* has to differ
 * rather than its styling: a React Flow prop (`Controls position`), a different set of toolbar
 * controls, a drawer that must not open itself. Tailwind's `md` is 768px, so this is one pixel
 * under it and the two can never drift apart.
 */
export const MOBILE_BREAKPOINT = 768;

/** The media query `useIsMobile()` watches. Written from the breakpoint so there is one number. */
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * What `MOBILE_QUERY` answers, as arithmetic a test can read.
 *
 * `matchMedia` is what actually decides at runtime — this is the same rule stated once so the
 * breakpoint has a test, and so anything that only has a width (a screenshot run, a layout
 * assertion) can ask the same question the CSS does.
 *
 * @param width Viewport width in CSS pixels.
 */
export function isMobileWidth(width: number): boolean {
  return Number.isFinite(width) && width < MOBILE_BREAKPOINT;
}

/**
 * Subscribes to a media query.
 *
 * `useSyncExternalStore` rather than an effect and a piece of state: `matchMedia` *is* an external
 * store, and the third argument is what keeps the server honest — the server has no viewport, so it
 * renders the desktop layout and React swaps in the real answer on hydration rather than the markup
 * disagreeing with itself.
 *
 * @param query Any CSS media query string.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The one query the editor asks: is the viewport narrower than Tailwind's `md`? */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
