import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

import { AuthNav } from "./AuthNav";
import { MobileNav } from "./MobileNav";
import { MARKETING_NAV } from "./nav";
import { Wordmark } from "./Brand";

/** Sticky, translucent, one hairline. Everything loud on the public pages happens below it. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Wordmark />

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

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AuthNav />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
