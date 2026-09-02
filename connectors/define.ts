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

export type ConnectorDef = {
  provider: string; name: string; category: "ai" | "chat" | "data" | "email" | "payments";
  kind: "apiKey" | "botToken" | "webhookUrl" | "signingSecret" | "oauth2";
  requiresFeature: string | null; fields: FieldSpec[]; docsUrl: string; icon: string; // lucide icon name
  /** Validates the pasted credential and captures what the pickers need (`meta.models`, …). */
  test: (secret: Record<string, string>) => Promise<ConnectorTestResult>;
  /** Lists remote objects for a config field (channels, bases, voices) — never secrets. */
  pick?: (kind: string, secret: Record<string, string>, meta: Record<string, unknown>) => Promise<{ id: string; label: string }[]>;
  /** Runs once the row exists and its id is known (registering a webhook, say). */
  afterCreate?: (args: { connectionId: string; secret: Record<string, string>; appOrigin: string }) => Promise<{ secret?: Record<string, string>; meta?: Record<string, unknown> }>;
};

/** Identity by design: it exists so every connector file is type-checked against one shape. */
export function defineConnector(def: ConnectorDef): ConnectorDef {
  return def;
}

/**
 * A `NodeDef.credential` naming a *set* of connections rather than one provider: the HTTP node
 * sends whichever token the chosen connection holds, so any provider will do.
 */
export const ANY_CREDENTIAL = "any";

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
