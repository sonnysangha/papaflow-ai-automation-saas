import { Bricolage_Grotesque } from "next/font/google";

/**
 * The display face for the public pages only — the app keeps Geist everywhere.
 *
 * Geist alone is the Vercel-default look; Bricolage's slightly irregular grotesk gives the
 * marketing headings a voice while the body copy, the node keys and the run ledger stay in
 * Geist / Geist Mono, exactly as they render inside the product. `opsz` is requested so the
 * large sizes get the tighter optical cut rather than a scaled-up text face.
 */
export const displayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-display",
});
