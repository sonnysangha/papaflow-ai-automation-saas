// The handful of names the three sides of the Builder have to agree on: the chat panel in the
// browser, the agent's channel, and its tools. No I/O, no server-only imports — the panel imports
// this module into the browser bundle.
import type { EveMessage, EveMessageInputRequest } from "eve/react";

/**
 * How the panel tells the agent which workflow this chat is editing.
 *
 * eve has no channel for structured per-session context: `clientContext` is documented as
 * *"Ephemeral client/page context for the next model call only. … rendered as user-role model
 * context messages … never persisted to durable session history"*
 * (`node_modules/eve/dist/src/client/types.d.ts`, `SendTurnOptions.clientContext`), so it reaches
 * the **model**, not `ctx` — a tool cannot read it, and a value the model retypes into a tool
 * argument is a value the model can get wrong.
 *
 * So the workflow id travels the same way the caller's identity does: as a request header the
 * agent's `AuthFn` verifies and projects into `ctx.session.auth.current.attributes`, next to
 * `orgId` and `userId`. It is not a capability — Convex re-checks that the workflow belongs to the
 * caller's organisation on every write — it is just the address of the canvas the user is looking
 * at.
 */
export const BUILDER_WORKFLOW_HEADER = "x-papaflow-workflow";

/**
 * The Clerk feature slug that pays for the Builder. Named once, checked three times: `<Show>` in
 * the panel, `has()` in `app/api/builder/session/route.ts`, and `requireBuilder` inside every
 * tool's `execute` (CLAUDE.md rule 3).
 */
export const BUILDER_FEATURE = "ai_builder";

/** The durable tool whose `ask()` the credential widget answers. */
export const REQUEST_CONNECTION_TOOL = "request_connection";

/** The option id `request_connection` treats as "the user declined". */
export const CANCEL_OPTION_ID = "cancel";

/** A pending `request_connection` ask, ready for the widget to render. */
export type PendingConnectionRequest = {
  requestId: string;
  /** The connector the agent is asking for (`slack`, `notion`, …), from the tool's own input. */
  provider: string;
  prompt: string;
  /** Connections the org already has, offered as options by the tool, plus its cancel entry. */
  options: readonly { id: string; label: string }[];
};

function providerOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const { provider } = input as { provider?: unknown };
  return typeof provider === "string" ? provider : "";
}

/**
 * The `request_connection` asks that are still waiting for an answer.
 *
 * The shape comes from eve's own documented detection pattern
 * (`node_modules/eve/docs/guides/frontend/overview.mdx`): a pending HITL request rides on a
 * `dynamic-tool` part in state `approval-requested`, at `part.toolMetadata.eve.inputRequest`.
 *
 * The widget is matched on **`part.toolName`**, not on anything inside the request:
 * `EveMessageInputRequest` — the React projection — carries `requestId`, `kind`, `prompt`,
 * `options`, `display` and `allowFreeform` and **no `action` field**, so there is no `toolName`
 * inside it to match on (the wire-level `InputRequest` has one; the two types are different).
 *
 * Every message is scanned, not just the last: an unrelated turn can add newer messages while an
 * approval stays open.
 */
export function pendingConnectionRequests(
  messages: readonly EveMessage[],
): PendingConnectionRequest[] {
  const pending: PendingConnectionRequest[] = [];

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool" || part.state !== "approval-requested") continue;
      if (part.toolName !== REQUEST_CONNECTION_TOOL) continue;

      const request: EveMessageInputRequest | undefined = part.toolMetadata?.eve?.inputRequest;
      if (!request) continue;

      pending.push({
        requestId: request.requestId,
        provider: providerOf(part.input),
        prompt: request.prompt,
        options: (request.options ?? [])
          .filter((option) => option.id !== CANCEL_OPTION_ID)
          .map((option) => ({ id: option.id, label: option.label })),
      });
    }
  }

  return pending;
}

/** What a tool call should read as in the transcript: "Added HTTP Request", and so on. */
export function toolCallLabel(toolName: string, input: unknown): string {
  const value = (name: string): string => {
    if (typeof input !== "object" || input === null) return "";
    const entry = (input as Record<string, unknown>)[name];
    return typeof entry === "string" ? entry : "";
  };

  switch (toolName) {
    case "list_node_types":
      return "Looked through the node catalogue";
    case "list_connections":
      return "Checked this workspace's connections";
    case "add_node":
      return `Added ${value("label") || value("type") || "a node"}`;
    case "connect_nodes": {
      const handle = value("sourceHandle");
      return `Connected ${value("from")} → ${value("to")}${handle ? ` (${handle})` : ""}`;
    }
    case "configure_node":
      return `Configured ${value("node") || "a node"}`;
    case "remove_node":
      return `Removed ${value("node") || "a node"}`;
    case REQUEST_CONNECTION_TOOL:
      return `Asked for a ${value("provider") || "connection"} connection`;
    case "validate_workflow":
      return "Validated the workflow";
    case "finish":
      return "Finished";
    default:
      return toolName;
  }
}
