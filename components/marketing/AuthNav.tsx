"use client";

import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { accentButton } from "./primitives";

/**
 * The right-hand end of the public header. `<Show>` resolves on the client and renders nothing
 * until Clerk has loaded, so the row reserves its height to keep the header from twitching.
 */
export function AuthNav() {
  return (
    <div className="flex h-9 items-center gap-1.5">
      <Show
        when="signed-in"
        fallback={
          <>
            <Link
              href="/sign-in"
              className={buttonVariants({
                variant: "ghost",
                size: "lg",
                className: "hidden px-3 sm:inline-flex",
              })}
            >
              Sign in
            </Link>
            <Link href="/sign-up" className={accentButton("px-3.5")}>
              Get started
            </Link>
          </>
        }
      >
        <Link href="/w" className={accentButton("px-3.5")}>
          Open app
          <ArrowRightIcon />
        </Link>
      </Show>
    </div>
  );
}
