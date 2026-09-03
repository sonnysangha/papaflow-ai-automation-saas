import { defineAgent, defineDynamic } from "eve";

import { providerFor } from "../../lib/ai/providers";
import { listOrgConnections, openOrgConnection } from "../../lib/connections-engine";

import { modelsFromMeta, pickConnection, pickModelId } from "./lib/models";

/**
 * The agent behind the "Build with AI" panel.
 *
 * Same two-scope model resolution as the Runtime agent (`agents/runtime/agent.ts`), for the same
 * reason: session and turn scopes may only return **model id strings** — *"Session/turn selections
 * must be model id strings; return live `LanguageModel` objects only from `step.started`"*
 * (`node_modules/eve/docs/agent-config.md`) — so the house model is the `session.started` answer
 * and the organisation's own key can only be honoured from `step.started`, which wins on
 * precedence (step > turn > session).
 *
 * The difference is where the model connection comes from. The Runtime agent is told which one to
 * use, because a person chose it in the Agent node's dropdowns and the engine put both ids in the
 * token. Nobody configures the Builder, so it chooses for itself — see `lib/models.ts` for the
 * ranking. A workspace with no AI connection still gets a working Builder on the house model.
 *
 * The key is decrypted inside the handler on every model step and captured by nothing: a provider
 * instance holding an org's key must never reach a module-level singleton (CLAUDE.md rule 1). The
 * cost is one Convex read plus one AES-GCM open per step, which is nothing next to a model call.
 */

/** The model a Builder chat gets when the organisation has no usable AI connection of its own. */
const HOUSE_MODEL = "openai/gpt-5.6-luna";

/**
 * How long one Builder chat may live before eve retires it.
 *
 * A chat is a real conversation, so unlike the Runtime agent this one is not one-shot: the panel
 * retires the session itself when `finish` lands or the user starts a new chat
 * (`components/canvas/BuilderPanel.tsx`), and this deadline only catches the chats nobody closes —
 * a tab shut mid-build, a panel abandoned. Without it eve's default keeps that `workflowEntry` run
 * Active for thirty days.
 *
 * Two hours rather than something tighter, because the option is an **absolute lifetime, not an
 * idle timer**: *"The deadline starts when the session is created"*
 * (`node_modules/eve/dist/src/shared/agent-definition.d.ts`, `AgentLimitsDefinition`). eve 0.49.0
 * has no idle timeout, so a thirty-minute cap would end a chat somebody was still using half an
 * hour in. An active turn is never interrupted — eve lets it settle and then completes the session
 * — but the next message would need a fresh chat, so the cap has to be longer than a build takes.
 */
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

/** Auth attributes are `string | readonly string[]`; every claim this agent reads is a string. */
function attribute(
  attributes: Readonly<Record<string, string | readonly string[]>> | undefined,
  name: string,
): string {
  const value = attributes?.[name];
  return typeof value === "string" ? value : "";
}

export default defineAgent({
  limits: { sessionTimeoutMs: SESSION_TIMEOUT_MS },
  model: defineDynamic({
    events: {
      "session.started": () => HOUSE_MODEL,

      "step.started": async (_event, ctx) => {
        const orgId = attribute(ctx.session.auth.current?.attributes, "orgId");
        if (!orgId) return HOUSE_MODEL;

        try {
          const choice = pickConnection(await listOrgConnections(orgId));
          if (!choice) return HOUSE_MODEL;

          const opened = await openOrgConnection(choice.connection.id, orgId);
          const apiKey = opened.secret.apiKey;
          if (typeof apiKey !== "string" || !apiKey) return HOUSE_MODEL;

          const modelId = pickModelId(modelsFromMeta(opened.meta), choice.preference.prefer);
          if (!modelId) return HOUSE_MODEL;

          return (await providerFor(opened.provider, apiKey))(modelId);
        } catch (error) {
          // A revoked key, a deleted connection, a provider with no factory. Falling back keeps the
          // chat alive on the house model; the reason never travels further than this log.
          console.error("builder/agent: BYOK model unavailable, using the house model", error);
          return HOUSE_MODEL;
        }
      },
    },
  }),
});
