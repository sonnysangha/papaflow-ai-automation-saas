import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import "@/components/marketing/marketing.css";
import { BrandMark, Wordmark } from "./Brand";
import { displayFont } from "./fonts";

/**
 * The frame around every Clerk component: brand on the left, the form on the right.
 *
 * The left panel disappears below `lg`, where a phone has no room for a manifesto, and a compact
 * lockup takes its place above the card. Nothing here touches Clerk's own routing, so
 * `/sign-in?__clerk_ticket=…` (an organisation invitation) still lands on `<SignIn />` untouched.
 */

const PROOF = [
  "Provider keys are sealed with AES-256-GCM and opened only inside the step that calls out.",
  "Runs are durable: a retry, a week-long wait or an approval survives a deploy.",
  "Workspaces are organisations — invite the team, share connections, one plan.",
] as const;

export function AuthShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${displayFont.variable} flex flex-1 bg-background text-foreground`}
    >
      <aside className="hidden w-2/5 max-w-lg flex-col justify-between border-r border-border bg-muted/30 p-10 lg:flex">
        <Wordmark />

        <div className="flex flex-col gap-8">
          <h2 className="pf-display text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance">
            {title}
          </h2>
          <ul className="flex flex-col gap-4">
            {PROOF.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--pf-accent)]"
                />
                <span className="text-sm text-pretty text-muted-foreground">
                  {line}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Link
          href="/"
          className="flex w-fit items-center gap-1.5 rounded-md font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          papaflow.app
        </Link>
      </aside>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-5 py-12 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md text-foreground lg:hidden"
        >
          <BrandMark />
          <span className="pf-display text-base font-semibold tracking-tight">
            PapaFlow
          </span>
        </Link>

        {children}
      </div>
    </div>
  );
}
