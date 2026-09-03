import { z } from "zod";

import { RESEND_USER_AGENT, verifiedDomains, type ResendDomain } from "@/connectors/resend";
import { ConnectorError, defineNode } from "../define";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Resend rejects requests without a User-Agent (403, error 1010) — docs/research/connectors-chat.md.
const USER_AGENT = RESEND_USER_AGENT;
// Until the org verifies its own domain, Resend only allows this sender (and only to the
// account owner's address); anything else is a 400 validation_error.
const SANDBOX_FROM = "PapaFlow <onboarding@resend.dev>";
/** Appended to Resend's own refusal when the sandbox sender ran into its one-recipient rule. */
const VERIFY_HINT = "Verify a domain in Resend to send to anyone.";

/**
 * The org's own Resend key when a connection is chosen, the platform's otherwise.
 *
 * `connectionId` is optional (`credentialOptional`), which is the whole point of this node: it
 * works on day one against `RESEND_API_KEY` with the sandbox sender, and the moment an org
 * connects its own Resend account it sends from that account's verified domain instead.
 */
function connectedKey(credential: Record<string, unknown> | undefined): string | undefined {
  const apiKey = credential?.apiKey;
  return typeof apiKey === "string" && apiKey ? apiKey : undefined;
}

/** The verified domains the connection's `test()` recorded, as `runNode` hands them over. */
function domainsOf(credential: Record<string, unknown> | undefined): ResendDomain[] | undefined {
  const domains = (credential?.meta as { domains?: unknown } | undefined)?.domains;
  if (!Array.isArray(domains)) return undefined;
  return domains.filter((domain): domain is ResendDomain => {
    const row = domain as { name?: unknown; status?: unknown };
    return typeof row?.name === "string" && typeof row?.status === "string";
  });
}

/**
 * The sender for a connected account: Resend refuses anything that is not on a domain the account
 * has verified, so refusing here turns a remote 400 into a message that names the alternatives.
 *
 * The exception is an account with *no* verified domain at all, which is where every new Resend
 * account starts. Refusing there made "connect Resend, send an email" impossible on a test account,
 * so it falls back to Resend's own sandbox sender instead — the same address the platform key uses.
 * Resend then allows one recipient (the account owner), and `refusalMessage` explains that in
 * Resend's own words if the user tries to reach anybody else.
 */
function connectedSender(from: string | undefined, credential: Record<string, unknown> | undefined): string {
  const domains = domainsOf(credential);
  if (!domains) {
    throw new ConnectorError(
      "Re-test this Resend connection so PapaFlow knows which domains it may send from",
      400,
    );
  }

  const verified = verifiedDomains(domains);
  // Nothing verified yet: Resend's sandbox sender is the only address this key may use, so a
  // configured `from` is ignored rather than sent into a certain 400.
  if (verified.length === 0) return SANDBOX_FROM;

  if (!from) {
    throw new ConnectorError(`Set a from address on one of: ${verified.join(", ")}`, 400);
  }

  const domain = from.slice(from.lastIndexOf("@") + 1).toLowerCase();
  if (!verified.some((verifiedDomain) => verifiedDomain.toLowerCase() === domain)) {
    throw new ConnectorError(
      `${from} is not on a verified Resend domain. Verified: ${verified.join(", ")}`,
      400,
    );
  }

  return from;
}

/**
 * How a refused send reads.
 *
 * Resend answers the sandbox sender's one-recipient rule with a 403 whose `message` says exactly
 * what went wrong and to whom ("You can only send testing emails to your own email address
 * (you@example.com). …"), so that sentence is repeated verbatim rather than paraphrased, with the
 * way out appended. Every other failure keeps the raw body, which is what the runs drawer showed
 * before.
 */
function refusalMessage(status: number, body: string, from: string): string {
  const raw = body || `Resend returned ${status}`;
  if (status !== 403 || from !== SANDBOX_FROM) return raw;

  let message: unknown;
  try {
    message = (JSON.parse(body) as { message?: unknown }).message;
  } catch {
    message = undefined;
  }

  return `${typeof message === "string" && message.length > 0 ? message : raw} ${VERIFY_HINT}`;
}

export const emailSend = defineNode({
  type: "email.send",
  name: "Send email",
  description: "Send a plain-text email through Resend.",
  category: "action",
  icon: "Mail",
  credential: "resend",
  // Without a connection the node still runs, on the platform key — see `connectedKey`.
  credentialOptional: true,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string().optional().describe("Your own Resend account, or leave empty"),
    to: z.email(),
    subject: z.string().min(1),
    text: z.string().min(1),
    from: z.email().optional(),
  }),
  outputs: z.object({ id: z.string() }),
  async run({ inputs, credential, executionId, nodeId }) {
    const connected = connectedKey(credential);
    const key = connected ?? process.env.RESEND_API_KEY;
    if (!key) throw new ConnectorError("No Resend key configured", 400);

    const from = connected ? connectedSender(inputs.from, credential) : (inputs.from ?? SANDBOX_FROM);

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        // 1-256 chars, deduplicated by Resend for 24h — makes a retried step safe to re-run.
        "Idempotency-Key": `${executionId}:${nodeId}`.slice(0, 256),
      },
      body: JSON.stringify({
        from,
        to: [inputs.to],
        subject: inputs.subject,
        text: inputs.text,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new ConnectorError(
        refusalMessage(response.status, text, from),
        response.status,
        response.headers.get("retry-after") ?? undefined,
      );
    }

    let id: unknown;
    try {
      id = (JSON.parse(text) as { id?: unknown }).id;
    } catch {
      id = undefined;
    }
    if (typeof id !== "string") {
      throw new ConnectorError(`Resend response had no id: ${text}`, 502);
    }

    return { id };
  },
});
