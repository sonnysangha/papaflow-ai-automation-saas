// Which of an organisation's connections a node's `credential` will accept, and what to do when
// none of them do.
//
// One rule, in one place, because three screens ask it and they must agree: the config panel's
// connection picker filters its dropdown by it, the node palette dims a node the org cannot run by
// it, and the connections page opens the right "Add connection" form from the link the palette
// hands out. Pure and React-free — `connectors/registry.ts` is data only — so it is imported by a
// client component and a test alike.

import { ANY_CREDENTIAL, CHAT_CREDENTIAL, CHAT_PROVIDERS, isTokenKind } from "@/connectors/define";
import { CONNECTORS } from "@/connectors/registry";
import type { ConnectorCatalogueEntry } from "@/connectors/registry";

export type ConnectorCategory = ConnectorCatalogueEntry["category"];

/** The shape of a connection this module needs; `ConnectionSummary` satisfies it. */
export type ConnectionLike = { provider: string; kind: string; status: string };

/** The providers a node with this `credential` accepts. */
export function providersFor(credential: string): string[] {
  // `chat` is not a category and not a prefix: it is the three chat apps that can render buttons a
  // person presses back. A Discord *webhook* and a Teams Workflows URL post messages and can never
  // answer one, so an Approval node must not offer them.
  if (credential === CHAT_CREDENTIAL) return [...CHAT_PROVIDERS];
  if (credential === "ai") {
    return Object.values(CONNECTORS)
      .filter((definition) => definition.category === "ai")
      .map((definition) => definition.provider);
  }
  if (CONNECTORS[credential]) return [credential];
  // A node may name a family rather than one provider: `discord` covers `discord-webhook` and
  // `discord-bot`, which are two ways of connecting the same app and post the same message.
  return Object.keys(CONNECTORS).filter((provider) => provider.startsWith(`${credential}-`));
}

/**
 * Which of the org's connections this node may be pointed at.
 *
 * `"any"` is not a provider and cannot be answered by provider at all: the HTTP node sends
 * whatever single token a connection holds, so every API key and bot token qualifies — and a
 * webhook URL or a signing secret, which are not tokens to send, does not.
 */
export function acceptsConnection(
  credential: string,
): (connection: { provider: string; kind: string }) => boolean {
  if (credential === ANY_CREDENTIAL) return (connection) => isTokenKind(connection.kind);

  const providers = new Set(providersFor(credential));
  return (connection) => providers.has(connection.provider);
}

/**
 * Whether the org holds a connection this node could actually run with.
 *
 * `active` only: a revoked Slack token or one that needs reconnecting is a row on the connections
 * page, not something a run can use, and offering the node as ready would move the failure from
 * the palette to the middle of a run.
 */
export function hasConnectionFor(
  credential: string,
  connections: readonly ConnectionLike[],
): boolean {
  const accepts = acceptsConnection(credential);
  return connections.some(
    (connection) => connection.status === "active" && accepts(connection),
  );
}

/** How a credential reads in "Connect …": the app's name, or what the family stands for. */
export function credentialLabel(credential: string): string {
  if (credential === ANY_CREDENTIAL) return "an account";
  if (credential === CHAT_CREDENTIAL) return "a chat app";
  if (credential === "ai") return "an AI provider";

  const exact = CONNECTORS[credential];
  if (exact) return exact.name;

  // A family: `discord` covers "Discord Webhook" and "Discord Bot", and what the user has to go and
  // connect is Discord. Capitalised from the id rather than guessed out of the member names, which
  // only share a prefix by convention.
  return credential.charAt(0).toUpperCase() + credential.slice(1);
}

/** What the palette asks a dimmed node for, and where clicking it goes. */
export type ConnectionNeed = {
  credential: string;
  /** "Slack", "an AI provider" — the words after "Connect". */
  label: string;
  /** `/connections?add=<credential>`, which the connections page resolves back into a form. */
  href: string;
};

/**
 * "This node cannot run yet, because nothing is connected to it" — or null when it can.
 *
 * Three ways to be fine: the node needs no credential, it works without one
 * (`credentialOptional`: the HTTP node sends an unauthenticated request, Send email falls back to
 * the platform key), or the org already holds one it accepts. A fourth, deliberately: while the
 * connections query is still loading nothing is dimmed, because a palette that greys itself out for
 * half a second on every page load looks broken.
 */
export function connectionNeed({
  credential,
  credentialOptional = false,
  connections,
}: {
  credential: string | null;
  credentialOptional?: boolean;
  /** `undefined` while the org's connections are loading. */
  connections: readonly ConnectionLike[] | undefined;
}): ConnectionNeed | null {
  if (!credential || credentialOptional) return null;
  if (connections === undefined) return null;
  if (hasConnectionFor(credential, connections)) return null;

  return {
    credential,
    label: credentialLabel(credential),
    href: `/connections?add=${encodeURIComponent(credential)}`,
  };
}

/** Which "Add connection" form `?add=…` asks for: one provider, one category, or step one. */
export type AddTarget = { provider?: string; category?: ConnectorCategory };

/**
 * Turns the `?add=` value back into something the dialog understands.
 *
 * A provider id skips straight to that app's form. Anything else is a family — `ai`, `chat`,
 * `discord` — which is not a provider and has no form of its own; if every provider in it shares a
 * category the picker is filtered to that category, and otherwise the dialog opens on the full list
 * rather than on nothing. An unknown value is null: a hand-typed URL must not open a blank form.
 */
export function resolveAddTarget(value: string | null | undefined): AddTarget | null {
  if (!value) return null;
  if (CONNECTORS[value]) return { provider: value };

  const categories = new Set(
    providersFor(value).flatMap((provider) => {
      const definition = CONNECTORS[provider];
      return definition ? [definition.category] : [];
    }),
  );
  if (categories.size === 1) return { category: [...categories][0] };
  return {};
}
