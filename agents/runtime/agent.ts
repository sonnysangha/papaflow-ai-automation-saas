import { defineAgent, defineDynamic } from "eve";

import { providerFor } from "../../lib/ai/providers";
import { openOrgConnection } from "../../lib/connections-engine";

/**
 * The agent behind the `ai.agent` node.
 *
 * Its model is resolved per session, because whose model it is depends on who opened the session:
 *
 * - `session.started` returns the **house model**, a plain AI Gateway model id string. Session and
 *   turn scopes may only return strings — "Session/turn selections must be model id strings; return
 *   live `LanguageModel` objects only from `step.started`" (`node_modules/eve/docs/agent-config.md`)
 *   — so this is also the fallback that keeps a turn alive when BYOK resolution fails.
 * - `step.started` returns a **live AI SDK model built from the org's own key** when the session's
 *   auth attributes carry `modelConnectionId` and `modelId`. Precedence is step > turn > session,
 *   so this wins whenever it produces something.
 *
 * The key is decrypted inside the handler on every model step and captured by nothing: a provider
 * instance holding an org's key must never reach a module-level singleton (CLAUDE.md rule 1). The
 * cost is one Convex read plus one AES-GCM open per step, which is nothing next to a model call.
 *
 * `providerFor` imports `@ai-sdk/*` lazily, and eve's package boundary requires every package an
 * authored module reaches to be a real dependency of the app — they all are (`docs/research/
 * versions.md`).
 */

/**
 * The model a run gets when the organisation has not chosen one: routed through the Vercel AI
 * Gateway, billed to the platform. Cheapest current OpenAI model on the Gateway's own list
 * (`curl https://ai-gateway.vercel.sh/v1/models`, 2026-09-03: $0.20/M in, $1.20/M out). Locally it
 * needs `AI_GATEWAY_API_KEY`; on Vercel the deployment's OIDC token pays for it.
 */
const HOUSE_MODEL = "openai/gpt-5.6-luna";

/**
 * How long one Agent-node session may live before eve retires it.
 *
 * This is a **backstop, not the mechanism**: `nodes/ai/agent.ts` calls `reset()` the moment it has
 * its answer, which ends the session in seconds. The deadline is what catches the sessions nothing
 * gets to reset — a step killed mid-flight, a deploy in the middle of a turn — so they do not sit
 * in the Workflows list as Active runs for eve's default month.
 *
 * Five minutes is safe despite an agent turn sometimes taking longer, because the deadline never
 * interrupts work: *"The deadline starts when the session is created and survives process restarts
 * and redeployments. If it elapses during an active turn, eve lets that turn settle before
 * completing the session normally."*
 * (`node_modules/eve/dist/src/shared/agent-definition.d.ts`, `AgentLimitsDefinition`.)
 *
 * It is an absolute lifetime rather than an idle timer — eve 0.49.0 has no idle timeout — which is
 * exactly right for a session that only ever holds one turn. Default is 2_592_000_000 ms (30 days).
 */
const SESSION_TIMEOUT_MS = 5 * 60 * 1_000;

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
        const attributes = ctx.session.auth.current?.attributes;
        const orgId = attribute(attributes, "orgId");
        const connectionId = attribute(attributes, "modelConnectionId");
        const modelId = attribute(attributes, "modelId");

        if (!orgId || !connectionId || !modelId) return HOUSE_MODEL;

        try {
          const connection = await openOrgConnection(connectionId, orgId);
          const apiKey = connection.secret.apiKey;
          if (typeof apiKey !== "string" || !apiKey) return HOUSE_MODEL;

          const workspaceId = connection.secret.workspaceId;
          return (await providerFor(connection.provider, apiKey, {
            ...(typeof workspaceId === "string" && workspaceId ? { workspaceId } : {}),
          }))(modelId);
        } catch (error) {
          // A revoked key, a deleted connection, a provider we have no factory for. Falling back
          // keeps the run alive on the house model rather than failing the turn before it starts;
          // the message never carries the reason further than this log.
          console.error("runtime/agent: BYOK model unavailable, using the house model", error);
          return HOUSE_MODEL;
        }
      },
    },
  }),
});
