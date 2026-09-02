// Office 365 connectors stopped working in May 2026; the replacement is a Power Automate flow the
// user creates from the Teams Workflows app ("Post to a channel when a webhook request is
// received"), which hands them a URL. There is no token: the flow's trigger is set to "Anyone",
// and sending an Authorization header actually makes the POST fail
// (docs/research/connectors-chat.md).
//
// So the only way to test the URL is to use it. The test posts a real, minimal Adaptive Card — the
// user sees "PapaFlow connected" in the channel, which is a better proof than a green tick.
import { defineConnector } from "./define";

const TIMEOUT_MS = 15_000;

/** Adaptive Cards 1.4 is the highest version Teams renders everywhere today. */
export const ADAPTIVE_CARD_VERSION = "1.4";

export const ADAPTIVE_CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";

/** The `{ type: "message", attachments: [...] }` envelope the Workflows trigger expects. */
export function adaptiveCardMessage(body: Record<string, unknown>[]): Record<string, unknown> {
  return {
    type: "message",
    attachments: [
      {
        contentType: ADAPTIVE_CARD_CONTENT_TYPE,
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: ADAPTIVE_CARD_VERSION,
          body,
        },
      },
    ],
  };
}

export const teamsConnector = defineConnector({
  provider: "teams",
  name: "Microsoft Teams",
  category: "chat",
  kind: "webhookUrl",
  requiresFeature: null,
  fields: [
    {
      name: "webhookUrl",
      label: "Workflow URL",
      kind: "url",
      placeholder: "https://prod-00.westeurope.logic.azure.com:443/workflows/…",
      help: "Teams → channel → … → Workflows → “Post to a channel when a webhook request is received”",
    },
  ],
  docsUrl:
    "https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498",
  icon: "Users",

  async test(secret) {
    const webhookUrl = secret.webhookUrl?.trim();
    if (!webhookUrl) return { ok: false, error: "Paste the workflow URL Teams gave you." };
    if (!webhookUrl.startsWith("https://")) {
      return { ok: false, error: "That does not look like a Teams workflow URL (it must be https)." };
    }

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        // No Authorization header on purpose: the "Anyone" trigger rejects requests that carry one.
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adaptiveCardMessage([{ type: "TextBlock", text: "PapaFlow connected" }])),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { ok: false, error: "Could not reach that workflow URL. Check it and try again." };
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return {
        ok: false,
        error:
          response.status === 401 || response.status === 403
            ? "Teams refused the post. Set the flow's trigger to “Anyone” and try again."
            : `Teams refused the post: ${detail || `HTTP ${response.status}`}`,
      };
    }

    return {
      ok: true,
      label: "Microsoft Teams",
      hint: webhookUrl.slice(-4),
      meta: { posted: true },
    };
  },
});
