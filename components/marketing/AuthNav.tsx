"use client";

import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { accentButton } from "./primitives";

/**
 * The right-hand end of the public header. `<Show>` resolves on the client and renders nothing
 * until Clerk has loaded, so the row reserves its height to keep the header from twitching.
 *
 * On a phone the row has room for exactly one auth control beside the theme toggle and the
 * hamburger — "Sign in", or "Open app" once there is a session — so "Get started" is left to the
 * mobile sheet and only joins the header at `sm`. Everything is 44px tall until then, which is why
 * the row's own height is `h-11` before it settles back to `h-9`.
 *
 * `cn()` rather than a bare `buttonVariants()` call: cva concatenates, so `hidden` handed in as a
 * class would sit alongside the base `inline-flex` and lose to it on stylesheet order alone —
 * which is exactly how "Sign in" used to render at 320px and push the hamburger off-screen.
 */
export function AuthNav() {
  return (
    <div className="flex h-11 items-center gap-0.5 sm:h-9 sm:gap-1.5">
      <Show
        when="signed-in"
        fallback={
          <>
            <Link
              href="/sign-in"
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                "h-11 px-2.5 sm:h-9 sm:px-3",
              )}
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className={accentButton("hidden px-3.5 sm:inline-flex")}
            >
              Get started
            </Link>
          </>
        }
      >
        <Link
          href="/w"
          className={accentButton("h-11 px-2.5 sm:h-9 sm:px-3.5")}
        >
          Open app
          <ArrowRightIcon className="max-sm:hidden" />
        </Link>
      </Show>
    </div>
  );
}
