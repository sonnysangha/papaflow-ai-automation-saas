import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

import { AuthNav } from "./AuthNav";
import { MobileNav } from "./MobileNav";
import { MARKETING_NAV } from "./nav";
import { Wordmark } from "./Brand";

/**
 * Sticky, translucent, one hairline. Everything loud on the public pages happens below it.
 *
 * Below `sm` every control in the row grows to a 44px touch target and the gaps close up, which is
 * what makes the whole set — wordmark, theme, one auth control, hamburger — fit inside 320px. The
 * right-hand group is pulled into the gutter (`-mr-1.5`) so the icon buttons look optically flush
 * while their hit areas still reach the edge of the screen.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-5 sm:gap-6 sm:px-8">
        <Wordmark className="-my-2.5 py-2.5 sm:my-0 sm:py-0" />

        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="-mr-1.5 ml-auto flex items-center gap-0 sm:mr-0 sm:gap-1">

          <ThemeToggle className="size-11 sm:size-7" />
          <AuthNav />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
