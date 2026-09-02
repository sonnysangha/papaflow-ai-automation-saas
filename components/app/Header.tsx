import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

const NAV_LINKS = [
  { href: "/w", label: "Workflows" },
  { href: "/runs", label: "Runs" },
  { href: "/connections", label: "Connections" },
  { href: "/settings", label: "Settings" },
] as const;

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="flex h-14 items-center gap-6 px-4">
        <Link
          href="/w"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          PapaFlow
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/w"
            afterCreateOrganizationUrl="/w"
          />
          <UserButton />
        </div>
      </div>
    </header>
  );
}
