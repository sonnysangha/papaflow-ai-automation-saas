// The one connector for a service PapaFlow already uses itself. An org that brings its own Resend
// key sends from its own verified domain instead of the platform's sandbox sender, so `email.send`
// stops being "onboarding@resend.dev to your own address only".
//
// `GET /domains` is both the test and the discovery: it is the cheapest authenticated call, and its
// answer is exactly what the node needs to check a `from` address against. Resend rejects any
// request without a `User-Agent` with a 403 (error 1010) before it reaches the API
// (docs/research/connectors-chat.md).
import { defineConnector } from "./define";

export const RESEND_API = "https://api.resend.com";

/** Resend blocks requests with no User-Agent. Exported so the node sends the same one. */
export const RESEND_USER_AGENT = "papaflow/0.1";

const TIMEOUT_MS = 15_000;

/** A domain as the connection stores it: the name to send from and whether it is usable yet. */
export type ResendDomain = { name: string; status: string };

export function resendDomains(payload: unknown): ResendDomain[] {
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .filter((row) => typeof row.name === "string")
    .map((row) => ({
      name: String(row.name),
      status: typeof row.status === "string" ? row.status : "unknown",
    }));
}

/** Only a verified domain may appear in a `from` address; the rest are still being set up. */
export function verifiedDomains(domains: readonly ResendDomain[]): string[] {
  return domains.filter((domain) => domain.status === "verified").map((domain) => domain.name);
}

export const resendConnector = defineConnector({
  provider: "resend",
  name: "Resend",
  category: "email",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "re_…",
      help: "Sending access is enough",
    },
  ],
  docsUrl: "https://resend.com/api-keys",
  icon: "MailCheck",

  async test(secret) {
    const apiKey = secret.apiKey?.trim();
    if (!apiKey) return { ok: false, error: "Paste a Resend API key (re_…)." };

    let response: Response;
    try {
      response = await fetch(`${RESEND_API}/domains`, {
        headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": RESEND_USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: "Could not reach Resend. Check your connection and try again." };
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "Resend rejected that API key." };
      }
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Resend refused the request: ${detail || `HTTP ${response.status}`}` };
    }

    const domains = resendDomains(await response.json().catch(() => ({})));
    const verified = verifiedDomains(domains);

    // A key with no verified domain still connects: the domain usually verifies minutes later, and
    // `email.send` is the one that has to refuse an address that is not covered yet.
    return {
      ok: true,
      label: verified.length > 0 ? `Resend (${verified[0]})` : "Resend (no verified domain)",
      hint: apiKey.slice(-4),
      meta: { domains },
    };
  },
});
