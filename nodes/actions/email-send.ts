import { z } from "zod";
import { ConnectorError, defineNode } from "../define";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Resend rejects requests without a User-Agent (403, error 1010) — docs/research/connectors-chat.md.
const USER_AGENT = "papaflow/0.1";
// Until the org verifies its own domain, Resend only allows this sender (and only to the
// account owner's address); anything else is a 400 validation_error.
const SANDBOX_FROM = "PapaFlow <onboarding@resend.dev>";

export const emailSend = defineNode({
  type: "email.send",
  name: "Send email",
  description: "Send a plain-text email through Resend.",
  category: "action",
  icon: "Mail",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    to: z.email(),
    subject: z.string().min(1),
    text: z.string().min(1),
    from: z.email().optional(),
  }),
  outputs: z.object({ id: z.string() }),
  async run({ inputs, credential, executionId, nodeId }) {
    const fromCredential = credential?.apiKey;
    const key = (typeof fromCredential === "string" ? fromCredential : "") || process.env.RESEND_API_KEY;
    if (!key) throw new ConnectorError("No Resend key configured", 400);

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
        from: inputs.from ?? SANDBOX_FROM,
        to: [inputs.to],
        subject: inputs.subject,
        text: inputs.text,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new ConnectorError(
        text || `Resend returned ${response.status}`,
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
