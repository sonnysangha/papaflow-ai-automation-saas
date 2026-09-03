"use client";

import { useTheme } from "next-themes";

/**
 * The dress Clerk's billing drawers wear.
 *
 * `<ClerkProvider>` in `app/layout.tsx` carries no `appearance`, so each Clerk surface is styled
 * where it is used: `components/marketing/ClerkCards.tsx` does it for sign-in and the org list,
 * and this does it for checkout, plan details and subscription details. The `variables` are the
 * same ones as the auth cards — Core 3 takes them as plain CSS values, so the neutrals are handed
 * straight through as `var(--…)` from `app/globals.css` and follow the theme with no work; the two
 * colours Clerk *derives* shades from cannot be a `var()`, so they are written out per theme.
 *
 * There are no `elements` overrides here on purpose: the auth cards size their own box, but these
 * are portalled drawers that Clerk lays out, and pinning a width to them would fight it.
 *
 * Both objects are built once at module load — a fresh `appearance` on every render would have
 * Clerk re-applying styles for nothing.
 */
function appearanceFor(dark: boolean) {
  return {
    variables: {
      colorPrimary: dark ? "#52d0d3" : "#00737e",
      colorPrimaryForeground: dark ? "#021819" : "#ffffff",
      colorBackground: "var(--card)",
      colorForeground: "var(--card-foreground)",
      colorMuted: "var(--muted)",
      colorMutedForeground: "var(--muted-foreground)",
      colorInput: "var(--background)",
      colorInputForeground: "var(--foreground)",
      colorBorder: "var(--border)",
      colorRing: "var(--ring)",
      borderRadius: "var(--radius)",
      fontFamily: '"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif',
      fontFamilyMono: '"Geist Mono", "Geist Mono Fallback", ui-monospace, monospace',
    },
  };
}

const LIGHT_APPEARANCE = appearanceFor(false);
const DARK_APPEARANCE = appearanceFor(true);

/**
 * `resolvedTheme` is undefined until next-themes has read the document class. A drawer only opens
 * on a click, long after that has settled, so the first-paint value is never the one Clerk sees.
 */
export function useClerkAppearance() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? DARK_APPEARANCE : LIGHT_APPEARANCE;
}
