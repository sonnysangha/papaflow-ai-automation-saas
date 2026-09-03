"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { MenuIcon } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/w", label: "Workflows" },
  { href: "/runs", label: "Runs" },
  { href: "/connections", label: "Connections" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * Which nav item the current URL belongs to.
 *
 * Prefix matching, so a workflow canvas (`/w/abc`) and its run history (`/w/abc/runs`) both keep
 * "Workflows" lit — the canvas is a place inside Workflows, not a fifth section. `/runs` and
 * `/w/…/runs` are deliberately different items: one is the workspace's history, the other is one
 * workflow's, and the longest matching prefix wins so the nested one does not claim both.
 */
export function activeNavHref(pathname: string, hrefs: readonly string[] = NAV_LINKS.map((l) => l.href)): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

function NavLinks({
  pathname,
  onNavigate,
  className,
  itemClassName,
}: {
  pathname: string;
  onNavigate?: () => void;
  className?: string;
  itemClassName?: string;
}) {
  const active = activeNavHref(pathname);

  return (
    <nav aria-label="Main" className={className}>
      {NAV_LINKS.map((link) => {
        const current = link.href === active;
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            aria-current={current ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              current
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              itemClassName,
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The app shell's one piece of chrome: where you are, where else you can go, which organisation
 * you are in, and who you are.
 *
 * A client component because the active item is decided by the URL. Clerk's two widgets are the
 * only things here that are not links, and they stay pinned right on every width.
 */
export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      {/* Tight at 320px on purpose: the trigger, the wordmark and Clerk's two widgets have to share
          one row, so the gaps and the page padding both grow only from `sm` up. */}
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                // A 28px button with a 44px reach.
                className="relative shrink-0 after:absolute after:-inset-2 after:content-[''] sm:hidden"
                aria-label="Open the main menu"
              />
            }
          >
            <MenuIcon />
          </SheetTrigger>
          <SheetContent side="left" className="data-[side=left]:sm:max-w-xs">
            <SheetHeader>
              <SheetTitle>PapaFlow</SheetTitle>
            </SheetHeader>
            <NavLinks
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
              className="flex flex-col gap-1 px-4 text-sm"
              itemClassName="px-3 py-2"
            />
            {/* The header row has no width left for it at 320px, so the toggle lives here instead
                — still one tap from anywhere, and never the thing that pushes the org switcher
                off the screen. */}
            <div className="mt-2 flex items-center gap-2 px-4 text-sm text-muted-foreground">
              <ThemeToggle />
              Theme
            </div>
          </SheetContent>
        </Sheet>

        <Link
          href="/w"
          className="shrink-0 rounded-md px-1 text-sm font-semibold tracking-tight text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          PapaFlow
        </Link>

        <NavLinks pathname={pathname} className="hidden items-center gap-1 text-sm sm:flex" />

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <ThemeToggle className="hidden sm:inline-flex" />
          {/* Clerk renders the org name in here; letting it shrink is what keeps the user button
              on screen at 320px. */}
          <div className="min-w-0 overflow-hidden">
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/w"
              afterCreateOrganizationUrl="/w"
            />
          </div>
          <UserButton />
        </div>
      </div>
    </header>
  );
}
