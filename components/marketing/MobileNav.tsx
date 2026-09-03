"use client";

import { useState } from "react";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { MenuIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { MARKETING_NAV } from "./nav";
import { accentButton } from "./primitives";

/**
 * The same links as the desktop header, in a sheet. Every link closes the sheet on the way out —
 * an in-page anchor does not change the route, so `onClick` is what dismisses it, not navigation.
 *
 * This is also where "Get started" lives on a phone, since the header itself only has room for one
 * auth control beside the theme toggle and this trigger. Rows are 44px and the footer clears the
 * home indicator, because the sheet reaches the bottom of the screen on the phones that have one.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="size-11 sm:size-8"
          />
        }
        className="md:hidden"
      >
        <MenuIcon />
      </SheetTrigger>
      {/*
        The sheet's own close button is a 28px icon everywhere else in the app; here it is the
        control a thumb reaches for first, so it is grown to 44px at the only width this exists at.
      */}
      <SheetContent
        side="right"
        className="w-[17rem] max-w-[86vw] [&_[data-slot=sheet-close]]:top-2 [&_[data-slot=sheet-close]]:right-2 [&_[data-slot=sheet-close]]:size-11"
      >
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>

        <MobileNavContents onNavigate={close} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Everything inside the sheet, as its own component: Base UI keeps a closed dialog's children out
 * of the tree entirely, so this is the only way the links and the calls to action can be rendered
 * — and asserted on — without driving the sheet open first.
 */
export function MobileNavContents({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
        {MARKETING_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className="flex min-h-11 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Show
          when="signed-in"
          fallback={
            <>
              <Link
                href="/sign-in"
                onClick={onNavigate}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-11 w-full",
                )}
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                onClick={onNavigate}
                className={accentButton("h-11 w-full")}
              >
                Get started
              </Link>
            </>
          }
        >
          <Link href="/w" onClick={onNavigate} className={accentButton("h-11 w-full")}>
            Open app
          </Link>
        </Show>
      </div>
    </>
  );
}
