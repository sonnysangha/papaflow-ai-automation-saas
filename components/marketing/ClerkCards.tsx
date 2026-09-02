"use client";

import { OrganizationList, SignIn, SignUp } from "@clerk/nextjs";
import { useTheme } from "next-themes";

/**
 * Clerk's prebuilt components, dressed in the app's tokens.
 *
 * Core 3 takes `appearance.variables` as plain CSS values, so the neutrals are handed straight
 * through as `var(--…)` from `app/globals.css` and follow the theme with no work. The two colours
 * Clerk *derives* shades from — the primary and its foreground — cannot be a `var()`, so they are
 * the marketing accent written out and picked per theme here. `logoPlacement: "none"` because the
 * page around the card is already branded.
 *
 * Both objects are built once at module load: a fresh `appearance` on every render would have
 * Clerk re-applying styles for nothing.
 */
function appearanceFor(dark: boolean) {
  return {
    options: { logoPlacement: "none" as const },
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
      fontFamilyMono:
        '"Geist Mono", "Geist Mono Fallback", ui-monospace, monospace',
    },
    elements: {
      rootBox: "w-full max-w-[25rem]",
      cardBox: "w-full border border-border shadow-sm",
    },
  };
}

const LIGHT_APPEARANCE = appearanceFor(false);
const DARK_APPEARANCE = appearanceFor(true);

/**
 * `resolvedTheme` is undefined until next-themes has read the document class, so the first paint
 * uses the light card; Clerk mounts its own markup after that, which is when this settles.
 */
function useAppearance() {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? DARK_APPEARANCE : LIGHT_APPEARANCE;
}

export function SignInCard() {
  const appearance = useAppearance();
  return <SignIn appearance={appearance} />;
}

export function SignUpCard() {
  const appearance = useAppearance();
  return <SignUp appearance={appearance} />;
}

export function SelectOrgCard() {
  const appearance = useAppearance();
  return (
    <OrganizationList
      hidePersonal
      afterSelectOrganizationUrl="/w"
      afterCreateOrganizationUrl="/w"
      appearance={appearance}
    />
  );
}
