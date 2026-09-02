import { z } from "zod";

import { adaptiveCardMessage } from "@/connectors/teams";
import { ConnectorError, defineNode } from "../define";

/**
 * A card in the Teams channel the connection's workflow posts to.
 *
 * The Power Automate trigger returns 202 with an empty body, so there is no message id to hand
 * back — `{ ok: true }` is the whole output. The URL is the credential: it is never an input, so it
 * cannot end up in a graph, a step row or the run log (CLAUDE.md rule 1).
 *
 * Two TextBlocks rather than one: a bolder heading and the body, which is what makes the card read
 * as a notification instead of a paragraph. Teams caps a message at 28 KB and throttles above
 * roughly 4 requests a second (docs/research/connectors-chat.md).
 */

function webhookUrlFrom(credential: Record<string, unknown> | undefined): string {
  const webhookUrl = credential?.webhookUrl;
  if (typeof webhookUrl !== "string" || !webhookUrl) {
    throw new ConnectorError("This node needs a Microsoft Teams connection", 400);
  }
  return webhookUrl;
}

export const teamsPostCardNode = defineNode({
  type: "teams.postCard",
  name: "Teams: Post card",
  description: "Post an Adaptive Card to a Microsoft Teams channel.",
  category: "chat",
  icon: "Users",
  credential: "teams",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    title: z.string().min(1),
    text: z.string().min(1),
  }),
  outputs: z.object({ ok: z.literal(true) }),
  async run({ inputs, credential }) {
    const response = await fetch(webhookUrlFrom(credential), {
      method: "POST",
      // No Authorization header: the "Anyone" trigger fails the POST when one is present.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        adaptiveCardMessage([
          { type: "TextBlock", text: inputs.title, weight: "Bolder", size: "Medium", wrap: true },
          { type: "TextBlock", text: inputs.text, wrap: true },
        ]),
      ),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ConnectorError(
        text || `Teams returned ${response.status}`,
        response.status,
        response.headers.get("retry-after") ?? undefined,
      );
    }

    return { ok: true as const };
  },
});
