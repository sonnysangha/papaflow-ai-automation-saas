import { createElement } from "react";
import { CreditCardIcon, type LucideIcon } from "lucide-react";

import { nodeIcon } from "@/components/canvas/node-icon";
import { connectorCatalogue, type ConnectorCatalogueEntry } from "@/connectors/registry";

/**
 * The connector wall, generated from `connectors/registry.ts` — adding a provider adds a tile
 * here with no edit to this file. Passing no features means everything the Pro plan unlocks comes
 * back with `allowed: false`, which is exactly the badge this grid wants to draw.
 *
 * Each tile names the credential the provider needs rather than showing a logo, because that is
 * the question someone actually has on a pricing-adjacent page: what do I have to go and fetch
 * before this works?
 */

const CATEGORY_LABELS: Record<ConnectorCatalogueEntry["category"], string> = {
  ai: "AI models",
  chat: "Chat",
  data: "Data and tools",
  email: "Email",
  payments: "Payments",
};

const KIND_LABELS: Record<ConnectorCatalogueEntry["kind"], string> = {
  apiKey: "API key",
  botToken: "Bot token",
  webhookUrl: "Webhook URL",
  signingSecret: "Signing secret",
  oauth2: "OAuth",
};

/** Connector icons are lucide names like the nodes', plus the few the canvas map has never seen. */
const EXTRA_ICONS: Record<string, LucideIcon> = { CreditCard: CreditCardIcon };

function ConnectorGlyph({ name }: { name: string }) {
  return createElement(EXTRA_ICONS[name] ?? nodeIcon(name), {
    className: "size-4 shrink-0 text-muted-foreground",
    "aria-hidden": true,
  });
}

export function WorksWith() {
  const catalogue = connectorCatalogue([]);
  const categories = Object.keys(CATEGORY_LABELS) as ConnectorCatalogueEntry["category"][];

  return (
    <div className="flex flex-col gap-10">
      {categories.map((category) => {
        const entries = catalogue.filter((entry) => entry.category === category);
        if (entries.length === 0) return null;

        return (
          <section key={category} className="flex flex-col gap-3">
            <h3 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">
              {CATEGORY_LABELS[category]}
            </h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map((entry) => (
                <li
                  key={entry.provider}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <ConnectorGlyph name={entry.icon} />
                  <span className="truncate text-sm font-medium">{entry.name}</span>
                  {entry.allowed ? null : (
                    <span className="shrink-0 rounded-full border border-[var(--pf-accent-line)] px-1.5 py-0.5 font-mono text-[0.65rem] text-[var(--pf-accent)]">
                      Pro
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[0.7rem] text-muted-foreground max-sm:hidden">
                    {KIND_LABELS[entry.kind]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
