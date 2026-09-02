"use client";

import { useState } from "react";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { MenuIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
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
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" aria-label="Open menu" />}
        className="md:hidden"
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="right" className="w-[17rem]">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>

        <nav className="flex flex-col gap-1 px-2">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              className="rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
          <Show
            when="signed-in"
            fallback={
              <>
                <Link
                  href="/sign-in"
                  onClick={close}
                  className={buttonVariants({
                    variant: "outline",
                    size: "lg",
                    className: "h-10 w-full",
                  })}
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  onClick={close}
                  className={accentButton("h-10 w-full")}
                >
                  Get started
                </Link>
              </>
            }
          >
            <Link
              href="/w"
              onClick={close}
              className={accentButton("h-10 w-full")}
            >
              Open app
            </Link>
          </Show>
        </div>
      </SheetContent>
    </Sheet>
  );
}
