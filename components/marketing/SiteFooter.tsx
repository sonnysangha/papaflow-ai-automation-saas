import Link from "next/link";

import { Wordmark } from "./Brand";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#works-with", label: "Works with" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Get started",
    links: [
      { href: "/sign-up", label: "Create an account" },
      { href: "/sign-in", label: "Sign in" },
      { href: "/docs", label: "Docs" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-10 sm:py-12 sm:px-8 md:flex-row md:justify-between">
        <div className="flex max-w-xs flex-col gap-3">
          <Wordmark className="-my-2.5 py-2.5 sm:my-0 sm:py-0" />
          <p className="text-sm text-pretty text-muted-foreground">
            Workflow automation on a canvas, with your own AI keys and runs that
            finish on their own.
          </p>
        </div>

        <div className="flex gap-10 sm:gap-20">
          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">
                {column.heading}
              </h2>
              {/* Rows are 44px on a phone, so the list opens up and the gap closes to match. */}
              <ul className="mt-1 flex flex-col gap-0 sm:mt-3 sm:gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground sm:min-h-0"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-8">

        <p className="border-t border-border pt-6 font-mono text-xs text-muted-foreground">
          © {new Date().getFullYear()} PapaFlow
        </p>
      </div>
    </footer>
  );
}
