import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The mark is the product in miniature: two nodes and the wire between them, drawn with the same
 * curve the canvas uses for an edge. It is the only place besides the primary button where the
 * accent appears in the chrome.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn("size-5 shrink-0", className)}
    >
      <path
        d="M5 14.5C9 14.5 11 5.5 15 5.5"
        stroke="var(--pf-accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="4" cy="14.5" r="2.6" fill="currentColor" />
      <circle cx="16" cy="5.5" r="2.6" fill="var(--pf-accent)" />
    </svg>
  );
}

/** Logo lockup. `href` is `/` on the public pages and `/w` once someone is signed in. */
export function Wordmark({
  href = "/",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <BrandMark />
      <span className="pf-display text-base font-semibold tracking-tight">
        PapaFlow
      </span>
    </Link>
  );
}
