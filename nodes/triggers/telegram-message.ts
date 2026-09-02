import { z } from "zod";

import { defineNode } from "../define";

/**
 * Starts a run when the connected bot receives a message.
 *
 * The node only *describes* the contract: `app/api/events/telegram/[connectionId]/route.ts` is what
 * actually verifies `X-Telegram-Bot-Api-Secret-Token`, finds the workflows whose trigger points at
 * that connection and calls `startRun` with the update as the payload. Like every trigger, its
 * step row is written straight from that payload (`workflows/run-graph.ts`), so `run` is never
 * called during a real run — it exists so the definition is complete and testable on its own.
 *
 * `chatId` is a string: Telegram chat ids can exceed 52 bits, so JSON numbers are not safe to
 * round-trip (docs/research/connectors-chat.md).
 */
export const telegramMessageTriggerNode = defineNode({
  type: "telegram.message",
  name: "Telegram message",
  description: "Starts the workflow when your bot receives a message.",
  category: "trigger",
  icon: "Send",
  credential: "telegram",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string().describe("Telegram bot connection to listen on"),
  }),
  outputs: z.object({
    update: z.any(),
    chatId: z.string(),
    text: z.string().optional(),
    from: z.any(),
  }),
  async run() {
    // Nothing to fetch and nothing to decide: the payload is the output, and the route built it.
    return { update: {}, chatId: "", from: null };
  },
});
