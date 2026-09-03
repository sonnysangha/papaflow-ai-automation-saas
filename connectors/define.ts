// How a user *connects* a provider, as opposed to what a node then *does* with it.
// A connector owns the form fields, the credential test call and (later) the pickers that
// turn a raw token into ids the config panel can offer. Users bring their own keys: nothing
// here reads a platform-wide env var.
//
// Like `nodes/`, these files are shared with Convex, with API routes and with `"use step"`
// code — no React, no Next imports, and no secret ever leaves in a return value beyond the
// four-character `hint`.

export type FieldSpec = { name: string; label: string; kind: "secret" | "text" | "url"; placeholder?: string; help?: string; required?: boolean };

export type ConnectorTestResult = { ok: true; label: string; hint: string; meta: Record<string, unknown> } | { ok: false; error: string };

/**
 * One remote object a config field can offer: a Slack channel, an Airtable base, a Notion property.
 *
 * `id` is what the node stores and sends back to the provider, `label` is what the dropdown shows.
 * Everything past those two is *description* of the object, for pickers whose answer shapes a second
 * field: a column's `type` says what may be written into it, and `choices` lists the values an
 * enum-like column accepts (an Airtable `singleSelect`, a Notion `status`). They are optional
 * because most lists — channels, chats, bases — are just names.
 *
 * Whatever a connector puts here crosses to the browser as-is (`/api/connections/:id/pick` returns
 * the array untouched), so a picker may only ever describe *remote objects*. No part of a
 * credential belongs in one (CLAUDE.md rule 1).
 */
export type PickerOption = {
  id: string;
  label: string;
  /** The provider's own type for this object — `singleSelect`, `multi_select`, `rich_text`. */
  type?: string;
  /** The values an enum-like object accepts, by name, in the order the provider lists them. */
  choices?: string[];
};

/**
 * How a user creates the third-party app a connector needs, as data the connections UI can render.
 *
 * Only Slack has one today: its bot token exists only after somebody has created a Slack app with
 * the right scopes, and pasting a manifest is the one route that gets all of them right first time.
 * The manifest is a plain JSON value so the catalogue stays serialisable — `connectorCatalogue`
 * hands it to a Client Component, and nothing here is secret or per-org.
 */
export type ConnectorSetup = {
  title: string;
  /** Ordered, one instruction each, written for someone who has never made an app there. */
  steps: string[];
  /** Pasted into the provider verbatim. JSON-serialisable, with placeholders for per-org URLs. */
  manifest: Record<string, unknown>;
};

export type ConnectorDef = {
  provider: string; name: string; category: "ai" | "chat" | "data" | "email" | "payments";
  kind: "apiKey" | "botToken" | "webhookUrl" | "signingSecret" | "oauth2";
  requiresFeature: string | null; fields: FieldSpec[]; docsUrl: string; icon: string; // lucide icon name
  /** Validates the pasted credential and captures what the pickers need (`meta.models`, …). */
  test: (secret: Record<string, string>) => Promise<ConnectorTestResult>;
  /** Lists remote objects for a config field (channels, bases, voices) — never secrets. */
  pick?: (kind: string, secret: Record<string, string>, meta: Record<string, unknown>) => Promise<PickerOption[]>;
  /** How to create the provider-side app this connector needs, if it needs one (Slack). */
  setup?: ConnectorSetup;
  /** Runs once the row exists and its id is known (registering a webhook, say). */
  afterCreate?: (args: { connectionId: string; secret: Record<string, string>; appOrigin: string }) => Promise<{ secret?: Record<string, string>; meta?: Record<string, unknown> }>;
};

/** Identity by design: it exists so every connector file is type-checked against one shape. */
export function defineConnector(def: ConnectorDef): ConnectorDef {
  return def;
}

/** The field kinds a human types or pastes, and so the ones worth cleaning up before they are used. */
const TYPED_KINDS: readonly FieldSpec["kind"][] = ["secret", "text", "url"];

/**
 * What a paste drags in with a credential, removed.
 *
 * Copying an API key out of a provider's console, a `.env` file or a terminal routinely carries a
 * trailing newline, a leading space, or the quotation marks around a shell variable — and every
 * one of them turns a perfectly good key into a 401 the user cannot see, because the field renders
 * as dots. `trim()` covers the whitespace (ECMAScript's WhiteSpace set includes NBSP and the BOM,
 * which is what a copy out of a web page tends to pick up); the loop covers `"sk-…"`, `'sk-…'` and
 * `` `sk-…` ``, matched pairs only, so a value that merely *starts* with a quote is left alone.
 */
export function normalizeFieldValue(value: string): string {
  let cleaned = value.trim();

  while (cleaned.length >= 2) {
    const first = cleaned[0];
    if (first !== '"' && first !== "'" && first !== "`") break;
    if (cleaned[cleaned.length - 1] !== first) break;
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

/**
 * A connector's form values with every typed field normalised (`normalizeFieldValue`).
 *
 * Only fields the connector actually declares are touched, and only the kinds a person types: a
 * blob that has grown provider-issued values (an OAuth refresh token, the signing secret a
 * `afterCreate` handed back) keeps them byte for byte. Applied once, where a credential enters the
 * system, so `test()` and the sealed row can never disagree about what the key is.
 */
export function normalizeSecretInput(
  def: ConnectorDef,
  secret: Record<string, string>,
): Record<string, string> {
  const typed = new Set(
    def.fields.filter((field) => TYPED_KINDS.includes(field.kind)).map((field) => field.name),
  );

  const cleaned: Record<string, string> = {};
  for (const [name, value] of Object.entries(secret)) {
    cleaned[name] = typed.has(name) ? normalizeFieldValue(value) : value;
  }
  return cleaned;
}

/**
 * A `NodeDef.credential` naming a *set* of connections rather than one provider: the HTTP node
 * sends whichever token the chosen connection holds, so any provider will do.
 */
export const ANY_CREDENTIAL = "any";

/**
 * A `NodeDef.credential` naming the chat apps that can render *buttons* a person presses, which is
 * a smaller set than "the chat category": a Discord webhook posts a message and can never receive
 * an interaction back, and a Teams Workflows webhook explicitly does not support buttons
 * (docs/research/connectors-chat.md). The Approval node uses this.
 */
export const CHAT_CREDENTIAL = "chat";

/** The three providers `CHAT_CREDENTIAL` accepts, each with a signed inbound route of its own. */
export const CHAT_PROVIDERS: readonly string[] = ["slack", "discord-bot", "telegram"];

/**
 * The picker kind a node asks for when it needs "somewhere to post" and does not care which of the
 * three chat providers answers: each connector aliases it onto its own list (Slack channels,
 * Discord channels, Telegram chats), so one field works for all three.
 */
export const TARGETS_PICKER = "targets";

/**
 * The picker kind an AI node's `model` field asks for.
 *
 * Unlike every other kind, no connector implements it: each AI connector's `test()` already writes
 * the provider's own list into `meta.models` at connect time (CLAUDE.md rule 11), so
 * `pickConnectionOptions` answers this one from the stored row — no provider round-trip, and the
 * sealed credential is never opened to fill a dropdown.
 */
export const MODELS_PICKER = "models";

/**
 * The kinds that hold exactly one bearer-style token — the only ones a node can authenticate with
 * generically. A `webhookUrl` is an address, a `signingSecret` verifies what arrives; neither is
 * something to send in a header.
 */
export const TOKEN_KINDS: readonly ConnectorDef["kind"][] = ["apiKey", "botToken"];

export function isTokenKind(kind: string): boolean {
  return (TOKEN_KINDS as readonly string[]).includes(kind);
}

/**
 * The name of the one field that is a connector's credential: `apiKey` for most, `token` for
 * GitHub, `botToken` for Slack and Telegram. Optional secrets do not count — Slack stores a
 * `signingSecret` beside its bot token — so a connector with anything other than exactly one
 * required secret field has no single token to send, and answers `null`.
 */
export function tokenFieldName(def: ConnectorDef | undefined): string | null {
  const names = (def?.fields ?? [])
    .filter((field) => field.kind === "secret" && field.required !== false)
    .map((field) => field.name);
  return names.length === 1 ? names[0] : null;
}
