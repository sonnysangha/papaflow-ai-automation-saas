import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Section labels are set as a node and the wire leaving it — the same two shapes as the logo.
 * It is a structural device that says something true: every section below is one more thing that
 * happens along a run, in order.
 */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-2.5 font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-[var(--pf-accent)]"
      />
      {children}
      <span
        aria-hidden
        className="h-px min-w-6 flex-1 bg-[var(--pf-accent-line)]"
      />
    </p>
  );
}

/** Buttons big enough to be the point of the page; `buttonVariants`' own sizes stop at 36px. */
export const CTA_BASE = "h-11 gap-2 px-5 text-[0.9375rem]";

/**
 * The accent is spent here and on the live wire in the hero — nowhere else.
 *
 * `cn()` wraps `buttonVariants` on purpose: cva only concatenates, so without tailwind-merge the
 * variant's own `bg-primary` sits alongside the accent and whichever Tailwind emitted last wins.
 */
export const ctaPrimary = (className?: string) =>
  cn(
    buttonVariants({ size: "lg" }),
    CTA_BASE,
    "bg-[var(--pf-accent-surface)] text-[var(--pf-accent-contrast)] hover:bg-[var(--pf-accent-surface)] hover:opacity-90",
    className,
  );

export const ctaSecondary = (className?: string) =>
  cn(buttonVariants({ variant: "outline", size: "lg" }), CTA_BASE, className);

/** The same accent fill on a button-sized control (header, plan cards, mobile sheet). */
export const accentButton = (className?: string) =>
  cn(
    buttonVariants({ size: "lg" }),
    "bg-[var(--pf-accent-surface)] text-[var(--pf-accent-contrast)] hover:bg-[var(--pf-accent-surface)] hover:opacity-90",
    className,
  );
