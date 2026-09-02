import { z } from "zod";

import { ConnectorError, defineNode, type ChildStep } from "../define";

/**
 * The Agent node: one goal in, one answer out, with the organisation's own connectors as tools.
 *
 * The work happens in the eve Runtime agent (`agents/runtime/`), not here. This node's job is to
 * authenticate as the engine, state the goal, and turn what comes back into a node output.
 *
 * **Transport.** `eve/client` over HTTP, reached through a dynamic `import()` of `@/lib/eve`.
 * Dynamic because `nodes/registry.ts` is imported by the canvas: everything statically reachable
 * from a node definition ends up in the browser bundle, and the same trick is what keeps the AI SDK
 * out of it in `nodes/ai/llm.ts`. `eve/client` itself is pure `fetch` — no `node:` specifier
 * anywhere under `node_modules/eve/dist/src/client/` — which is why the token in `lib/eve.ts` is
 * signed with Web Crypto rather than `node:crypto`: a `node:` import reachable from `nodes/` breaks
 * both the browser bundle and the rule that keeps this directory portable.
 *
 * **The credential.** `credential: "ai"` is not used to call a model here — the agent builds the
 * model itself, inside its own process, from the same connection. It is declared so that `runNode`
 * proves the connection exists, is active, belongs to this org and is covered by the plan *before*
 * a session is opened; the opened secret is then simply not used (CLAUDE.md rule 1 — it must not
 * reach the model, and `connectionId` is all the agent is told).
 */

/** What one tool call looked like, as the node reports it and `runNode` writes it as a child row. */
const TOOL_CALL = z.object({
  name: z.string(),
  input: z.any(),
  output: z.any(),
  error: z.string().optional(),
});

type ToolCall = z.infer<typeof TOOL_CALL>;

/**
 * JSON as eve's client types it (`node_modules/eve/dist/src/shared/json.d.ts`). Declared here rather
 * than imported: that module lives behind eve's `#shared/...` subpath, which is internal.
 */
type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

/**
 * The events `MessageResult` carries, narrowed to the two that describe a tool call.
 *
 * `actions.requested` carries what the model asked for (`{ callId, kind: "tool-call", toolName,
 * input }`), `action.result` what came back (`{ result: { callId, toolName, output, isError },
 * status }`). Typed structurally rather than imported: the protocol types live behind eve's `#`
 * subpath imports, and this file must stay importable from the canvas.
 */
type StreamEvent = {
  type: string;
  data?: {
    actions?: readonly { callId?: string; kind?: string; toolName?: string; input?: unknown }[];
    result?: { callId?: string; toolName?: string; output?: unknown; isError?: boolean };
    status?: string;
    error?: { message?: string };
  };
};

/** Pairs each requested tool call with its result, in the order the model made them. */
function toolCallsFrom(events: readonly StreamEvent[]): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  const order: string[] = [];

  for (const event of events) {
    if (event.type === "actions.requested") {
      for (const action of event.data?.actions ?? []) {
        if (action.kind !== "tool-call" || !action.callId) continue;
        calls.set(action.callId, {
          name: action.toolName ?? "tool",
          input: action.input ?? null,
          output: null,
        });
        order.push(action.callId);
      }
      continue;
    }

    if (event.type === "action.result") {
      const result = event.data?.result;
      const existing = result?.callId ? calls.get(result.callId) : undefined;
      if (!result || !existing) continue;

      existing.output = result.output ?? null;
      if (event.data?.status === "failed" || result.isError) {
        existing.error = event.data?.error?.message ?? "The tool call failed.";
      } else if (event.data?.status === "rejected") {
        existing.error = "The tool call was not approved.";
      }
    }
  }

  return order.flatMap((callId) => {
    const call = calls.get(callId);
    return call ? [call] : [];
  });
}

/**
 * The JSON Schema for `outputFields`, built by hand rather than lowered from zod.
 *
 * The client would happily lower a Standard Schema, but the fields are user-typed strings: a
 * hand-built object is one fewer moving part between the config panel and the model, and
 * `additionalProperties: false` is what stops the agent from inventing extra keys.
 */
function outputSchemaFor(fields: readonly string[]): JsonObject | undefined {
  const named = fields.map((field) => field.trim()).filter((field) => field.length > 0);
  if (named.length === 0) return undefined;

  return {
    type: "object",
    properties: Object.fromEntries(named.map((field) => [field, { type: "string" }])),
    required: named,
    additionalProperties: false,
  };
}

export const agentNode = defineNode({
  type: "ai.agent",
  name: "AI Agent",
  description: "Give a goal to an agent that can use this workspace's connections as tools.",
  category: "ai",
  icon: "Bot",
  credential: "ai",
  requiresFeature: "ai_agent",
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    model: z.string().min(1),
    goal: z.string().min(1).describe("What the agent should achieve. Templates are resolved first"),
    maxSteps: z
      .number()
      .int()
      .positive()
      .max(50)
      .default(8)
      .describe("Tool-call budget stated to the agent"),
    outputFields: z
      .array(z.string())
      .default([])
      .describe("Name fields here to get a structured `result` instead of prose"),
  }),
  outputs: z.object({
    text: z.string(),
    result: z.any(),
    toolCalls: z.array(TOOL_CALL),
  }),
  /** One drawer sub-row per tool call, nested under this node's step (`runNode` writes them). */
  children: (out): ChildStep[] =>
    out.toolCalls.map((call) => ({
      name: call.name,
      input: call.input,
      output: call.output,
      error: call.error,
    })),
  async run({ inputs, orgId, executionId, planSlug }) {
    // Both imports are dynamic: `@/lib/eve` reaches `eve/client`, and neither belongs in the
    // canvas's bundle. See the note at the top of the file.
    const { mintEngineToken, runtimeClient } = await import("@/lib/eve");

    const token = await mintEngineToken({
      orgId,
      // The plan snapshotted on the execution. The agent's tool resolver gates Pro connectors on it,
      // so a free org's agent is never offered a tool `runNode` would refuse (CLAUDE.md rule 3);
      // erring towards the free plan when the context has none is the safe direction.
      plan: planSlug ?? "free_org",
      executionId,
      modelConnectionId: inputs.connectionId,
      modelId: inputs.model,
    });

    const outputSchema = outputSchemaFor(inputs.outputFields);
    const client = runtimeClient(token);

    let result;
    try {
      const { response } = await client.sessions.create({
        message: inputs.goal,
        // eve 0.49.0 has no per-turn tool-step cap (`SendTurnOptions` is `turnPolicy`,
        // `clientContext`, `outputSchema`, `streamReconnectPolicy`, `signal`, `headers`), so the
        // budget is stated to the model rather than enforced by the runtime.
        clientContext: `Use at most ${inputs.maxSteps} tool calls before you answer.`,
        ...(outputSchema ? { outputSchema } : {}),
      });
      result = await response.result();
    } catch (cause) {
      // A transport failure: the agent service is down, or the token was refused. 502 so the step
      // gets the default retries rather than failing the run outright.
      throw new ConnectorError(
        `Could not reach the agent service: ${cause instanceof Error ? cause.message : String(cause)}`,
        502,
      );
    }

    const toolCalls = toolCallsFrom(result.events as readonly StreamEvent[]);

    // A parked human-in-the-loop question has nobody to answer it: a run is not a conversation. The
    // node fails with the question in the message so the person reading the run knows what to fix.
    if (result.inputRequests.length > 0) {
      const asked = result.inputRequests
        .map((request) => (request as { prompt?: unknown }).prompt)
        .filter((prompt): prompt is string => typeof prompt === "string");
      throw new ConnectorError(
        "The agent asked a question, but a workflow run has nobody to answer it: " +
          `${asked[0] ?? "unknown question"}. Put the missing detail in the goal.`,
        400,
      );
    }

    if (result.status === "failed") {
      throw new ConnectorError(
        `The agent could not finish: ${result.message ?? "no reason reported"}.`,
        400,
      );
    }

    if (outputSchema && result.data === undefined) {
      throw new ConnectorError(
        "The agent finished without producing the structured fields this node asked for.",
        400,
      );
    }

    return {
      text: result.message ?? "",
      result: result.data ?? null,
      toolCalls,
    };
  },
});
