// What one connection says about itself: the app behind a stored provider, the caveats, and the
// URL its provider should call. Pure, and React-free, so the table row and the phone card are both
// markup over the same object — and so the awkward parts (which providers have an inbound URL, and
// which of those had it registered for them) have tests rather than a screenshot.

import { CONNECTORS } from "@/connectors/registry";
import { RESEND_SANDBOX_NOTE, resendDomains, verifiedDomains } from "@/connectors/resend";
import { SLACK_EVENTS_PATH } from "@/connectors/slack";
import { appOrigin } from "@/lib/app-origin";

import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";

export type ConnectionStatus = "active" | "needs_reconnect" | "revoked";

/** The projection `api.connections.list` returns — never the sealed secret (CLAUDE.md rule 1). */
export type ConnectionRowData = {
  _id: string;
  provider: string;
  label: string;
  hint: string;
  status: ConnectionStatus;
  meta?: unknown;
  updatedAt: number;
};

/** The same colour language as the run statuses: green good, amber wants attention, red dead. */
export const STATUS_TONE: Record<ConnectionStatus, string> = {
  active: "bg-emerald-500",
  needs_reconnect: "bg-amber-500",
  revoked: "bg-destructive",
};

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  active: "Active",
  needs_reconnect: "Needs reconnect",
  revoked: "Revoked",
};

/** `meta.models` is `v.any()` on the wire, so it is counted rather than trusted. */
export function modelCount(meta: unknown): number | null {
  if (typeof meta !== "object" || meta === null) return null;
  const models = (meta as { models?: unknown }).models;
  return Array.isArray(models) ? models.length : null;
}

/**
 * Where this connection's provider should send its events, and what the user has to do about it.
 *
 * Two ways a connection gets one. `meta.inboundUrl` is written by the connector's `afterCreate`
 * (`connectors/{telegram,stripe}.ts`), because the URL contains the connection id and so cannot
 * exist before the row does. Slack and Discord have nothing to register at connect time — their
 * URLs are pasted into an app's settings by hand — so those are derived here from the id the row
 * already has. Everything else has nothing inbound to offer and gets no row.
 */
export function inboundFor(
  connection: ConnectionRowData,
): { url: string; hint: string } | null {
  const meta = typeof connection.meta === "object" && connection.meta !== null ? connection.meta : {};
  const registered = (meta as { inboundUrl?: unknown }).inboundUrl;

  if (typeof registered === "string" && registered.length > 0) {
    if (connection.provider === "telegram") {
      const webhookSet = (meta as { webhookSet?: unknown }).webhookSet;
      return {
        url: registered,
        hint:
          webhookSet === false
            ? "Telegram was not told about this URL — it only accepts https, so reconnect once this app has an https origin"
            : "Telegram webhook registered",
      };
    }
    if (connection.provider === "stripe") {
      return { url: registered, hint: "Paste this URL into Stripe's webhook settings" };
    }
    return { url: registered, hint: "Send this provider's events to this URL" };
  }

  // Interactivity URLs: where an Approval node's buttons come back to. Nothing registers these, so
  // the connection is only half-wired until the user pastes the URL where the hint says.
  //
  // Slack's is the same URL for every connection — presses are matched to a row by the workspace id
  // Slack puts in them (`connections.externalId`), which is what lets the app manifest carry it —
  // so this is the URL the setup dialog already put in the manifest, restated for a connection made
  // before that existed. The per-connection URL still answers and is deliberately not shown: two
  // URLs for one field is the confusion, not the fix.
  if (connection.provider === "slack") {
    return {
      url: `${appOrigin()}${SLACK_EVENTS_PATH}`,
      hint: "Already in the manifest — Slack app → Interactivity & Shortcuts → Request URL (needs the signing secret on this connection)",
    };
  }
  if (connection.provider === "discord-bot") {
    return {
      url: `${appOrigin()}/api/events/discord/${connection._id}`,
      hint: "Paste into your Discord app → General Information → Interactions Endpoint URL (needs the public key on this connection)",
    };
  }

  return null;
}

/**
 * A standing caveat about what this connection can do — not a failure, and not something a re-test
 * would clear.
 *
 * Resend is the only one so far, and it is the one people hit five minutes in: a brand-new account
 * has a working key and no verified domain, so `email.send` falls back to Resend's sandbox sender
 * and Resend allows exactly one recipient. Saying so on the row is the difference between "Send
 * email failed" and "of course it did".
 */
export function noticeFor(connection: ConnectionRowData): string | null {
  if (connection.provider !== "resend") return null;

  const meta = typeof connection.meta === "object" && connection.meta !== null ? connection.meta : {};
  const domains = resendDomains({ data: (meta as { domains?: unknown }).domains });
  return verifiedDomains(domains).length > 0 ? null : RESEND_SANDBOX_NOTE;
}

export type ConnectionRowView = {
  /** The connector's display name, or the stored provider id when the catalogue has lost it. */
  name: string;
  /** The connector's icon name, for `NodeIcon`. */
  icon: string | undefined;
  /** `"ai"` connectors are the only ones with models to refresh. */
  isAi: boolean;
  /** `••••abcd` — the only part of the secret that ever reaches a browser. */
  maskedKey: string;
  statusLabel: string;
  statusTone: string;
  models: number | null;
  inbound: { url: string; hint: string } | null;
  notice: string | null;
  updated: string;
  updatedTitle: string;
  menuLabel: string;
  copyLabel: string;
};

export function connectionRowView(connection: ConnectionRowData): ConnectionRowView {
  // `CONNECTORS` is data here: the name, icon and category behind a stored provider.
  const definition = CONNECTORS[connection.provider];

  return {
    name: definition?.name ?? connection.provider,
    icon: definition?.icon,
    isAi: definition?.category === "ai",
    maskedKey: `••••${connection.hint}`,
    statusLabel: STATUS_LABEL[connection.status],
    statusTone: STATUS_TONE[connection.status],
    models: modelCount(connection.meta),
    inbound: inboundFor(connection),
    notice: noticeFor(connection),
    updated: `updated ${formatRelativeTime(connection.updatedAt)}`,
    updatedTitle: formatAbsoluteTime(connection.updatedAt),
    menuLabel: `Actions for ${connection.label}`,
    copyLabel: `Copy the inbound URL for ${connection.label}`,
  };
}
