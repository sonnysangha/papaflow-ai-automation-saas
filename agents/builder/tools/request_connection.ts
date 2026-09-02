import { defineTool } from "eve/tools";
import { ask, type ToolInputResponse } from "eve/workflow";
import { sleep } from "workflow";
import { z } from "zod";

import { CANCEL_OPTION_ID } from "@/lib/builder-protocol";

import { confirmConnection, prepareConnectionRequest } from "../lib/connection-steps";
import { requireIdentity } from "../lib/session";

/*
 * How the Builder gets a credential it does not have: it asks, and waits.
 *
 * This is the one durable tool. The "use workflow" directive is the first statement of execute, so
 * eve starts a durable run for the call and parks the turn while it waits — nothing is running in
 * between, and the run survives a deploy, a reload and a night's sleep. The body is orchestration
 * only: the plan check, the connection list and the ownership proof are steps in
 * ../lib/connection-steps.ts (CLAUDE.md rule 4).
 *
 * NOTE — no backticks in this file's comments. eve validates the directive by scanning the source
 * text (detectWorkflowPatterns in @workflow/builders, called from
 * internal/workflow-bundle/authored-workflow-directives.js): it blanks template literals *before*
 * comments, so a backtick in a comment starts a phantom template literal that swallows the
 * directive's own line and the build fails with 'use workflow' ... is not on its own line.
 *
 * The secret never comes back through here. ask() publishes an input.requested event; the chat
 * panel matches it on part.toolName === "request_connection" and renders its own credential
 * widget, which posts the pasted key to POST /api/connections — the one route in the app that sees
 * a plaintext credential — and answers this ask with nothing but the new connection's id
 * (CLAUDE.md rule 1). An id the user could have read off the connections page is all the model is
 * ever told.
 *
 * The timeout is a race, and the sleep branch resolves to undefined, not to a fabricated answer:
 * "const answer = await Promise.race([pending, sleep('4h')]); if (answer === undefined) return
 * { deployed: false, reason: 'timed out' };" (node_modules/eve/docs/tools/workflows.mdx).
 */
export default defineTool({
  description:
    "Ask the user to connect an app PapaFlow has no credential for yet, and wait for them to do " +
    "it. Returns the connectionId to configure the node with. Never ask for a key, a token or a " +
    "password in chat — this tool is the only way to get one, and you never see it.",
  inputSchema: z.object({
    provider: z
      .string()
      .describe('The connector slug the workflow needs, e.g. "slack", "notion", "openai".'),
    reason: z
      .string()
      .describe("One sentence: which node needs it and what it will do. Shown to the user."),
  }),
  async execute({ provider, reason }, ctx) {
    "use workflow";

    // Pure: reads the attributes the channel projected from the caller's Clerk token. Everything
    // that touches Clerk, Convex or the vault happens in the two steps below.
    const identity = requireIdentity(ctx);
    const context = await prepareConnectionRequest(identity, provider);

    const usable = context.existing.filter((connection) => connection.status === "active");
    const pending = ask(ctx, {
      prompt:
        `PapaFlow needs a ${context.providerName} connection. ${reason}` +
        (usable.length > 0
          ? "\n\nPick one this workspace already has, or add a new one."
          : "\n\nAdd one below — the credential goes straight into the vault and I never see it."),
      display: "confirmation",
      allowFreeform: true,
      options: [
        ...usable.map((connection) => ({
          id: connection.id,
          label: `Use "${connection.label}"`,
        })),
        { id: CANCEL_OPTION_ID, label: "Not now" },
      ],
    });

    // A day is long enough for "I'll get the token from my admin"; longer would mean a run that
    // outlives the workflow it was building.
    const answer = (await Promise.race([pending, sleep("24h")])) as ToolInputResponse | undefined;

    if (answer === undefined) {
      return { connected: false, reason: "The request timed out after 24 hours." };
    }
    if (answer.optionId === CANCEL_OPTION_ID) {
      return {
        connected: false,
        reason:
          "The user declined. Leave the node unconfigured, say which one still needs a connection, and stop.",
      };
    }

    const connectionId = (answer.text ?? answer.optionId ?? "").trim();
    if (!connectionId) {
      return { connected: false, reason: "The user answered with nothing usable." };
    }

    return { connected: true, ...(await confirmConnection(identity, connectionId, provider)) };
  },
});
