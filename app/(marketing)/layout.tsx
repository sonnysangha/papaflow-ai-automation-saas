import type { Metadata } from "next";

import "@/components/marketing/marketing.css";
import { displayFont } from "@/components/marketing/fonts";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

/**
 * The public shell. Nothing here calls `auth()`: the header decides between "Sign in" and
 * "Open app" on the client with Clerk's `<Show>`, which keeps `/`, `/pricing` and `/docs`
 * statically renderable.
 */
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN ?? "http://localhost:3000"),
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${displayFont.variable} flex flex-1 flex-col bg-background text-foreground`}
    >
      {/*
        `not-sr-only` zeroes the padding on its way back, so the visible size has to be re-stated
        under the same `focus:` — otherwise the link returns as a 20px sliver of text.
      */}
      <a
        href="#main"
        className="sr-only rounded-md bg-background text-sm font-medium ring-3 ring-ring/50 focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:px-4! focus:py-3!"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
