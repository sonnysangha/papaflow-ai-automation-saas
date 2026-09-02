import { defineAgent, defineDynamic } from "eve";

import { providerFor } from "@/lib/ai/providers";
import { listOrgConnections, openOrgConnection } from "@/lib/connections-engine";

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

/** Auth attributes are `string | readonly string[]`; every claim this agent reads is a string. */
function attribute(
  attributes: Readonly<Record<string, string | readonly string[]>> | undefined,
  name: string,
): string {
  const value = attributes?.[name];
  return typeof value === "string" ? value : "";
}

export default defineAgent({
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
