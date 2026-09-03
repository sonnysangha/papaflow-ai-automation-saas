// "Is this node ready to run?", answered on the canvas rather than at run time.
//
// The same three walls `runNode` and `validateWorkflow` put up — the plan, the connection, the
// node's own zod schema — asked one node at a time so a card can say so before anybody presses
// Run. Pure and React-free: the canvas memoises it per graph, and a test calls it directly.
//
// Wording is copied from `lib/validate-workflow.ts` rather than reinvented, so the badge on a card
// and the Builder's `validate_workflow` output describe the same problem the same way.

import type { ConnectionLike } from "@/lib/connection-match";
import { credentialLabel } from "@/lib/connection-match";
import { inputIssues } from "@/lib/validate-workflow";
import { NODES } from "@/nodes/registry";

/**
 * What is standing between this node and a run, worst first.
 *
 * - `unavailable` — the org's plan does not include the node at all, so nothing else matters.
 * - `needs_connection` — no account chosen, or the one it points at is gone.
 * - `reconnect` — the account is there but its token is dead.
 * - `incomplete` — the form has an empty required field.
 * - `ready` — nothing to say.
 */
export type NodeSetupState =
  | "ready"
  | "needs_connection"
  | "reconnect"
  | "incomplete"
  | "unavailable";

export type NodeSetup = {
  state: NodeSetupState;
  /** Every problem found, in precedence order. Empty when the state is `ready`. */
  problems: string[];
};

const READY: NodeSetup = { state: "ready", problems: [] };

/** What this module reads off a canvas node — `WorkflowNodeType` satisfies it. */
export type SetupNode = {
  data: { nodeType: string; inputs: Record<string, unknown> };
};

/** A connection as the card needs it: `api.connections.list`'s projection satisfies this. */
export type SetupConnection = ConnectionLike & { _id: string; label: string };

/** The short word on the badge — a card has room for one. */
export const SETUP_BADGE_LABEL: Record<Exclude<NodeSetupState, "ready">, string> = {
  unavailable: "Upgrade",
  needs_connection: "Connect",
  reconnect: "Reconnect",
  incomplete: "Needs setup",
};

/**
 * Everything wrong with one node's configuration.
 *
 * `connections` is `undefined` while the org's list is loading, and that is deliberately not the
 * same as an empty list: dimming every connected node for the half second before the query lands
 * would make a healthy canvas look broken, so connection checks are skipped until the rows arrive.
 * The plan check behaves the same way with `features`.
 *
 * A `{{ template }}` in a required field is configuration, not a hole — `inputIssues` already
 * knows that, which is exactly why it is reused here instead of a second `safeParse`.
 */
export function nodeSetup(
  node: SetupNode,
  connections: readonly SetupConnection[] | undefined,
  features: readonly string[] | undefined,
): NodeSetup {
  const definition = NODES[node.data.nodeType];
  if (!definition) {
    return {
      state: "incomplete",
      problems: [`Unknown node type “${node.data.nodeType}”.`],
    };
  }

  const inputs = node.data.inputs ?? {};
  const problems: string[] = [];
  let state: NodeSetupState = "ready";
  // Worst wins: each check below only takes the state if it outranks what is already there.
  const raise = (next: Exclude<NodeSetupState, "ready">, problem: string) => {
    problems.push(problem);
    if (RANK[next] > RANK[state]) state = next;
  };

  if (features && definition.requiresFeature && !features.includes(definition.requiresFeature)) {
    raise("unavailable", "Not on your plan");
  }

  const chosen = inputs.connectionId;
  const connectionId = typeof chosen === "string" && chosen.length > 0 ? chosen : null;

  if (definition.credential && !definition.credentialOptional && !connectionId) {
    // Mirrors `validateWorkflow`'s required-credential rule, in the words a person needs rather
    // than the ones the Builder agent does.
    raise("needs_connection", "Choose a connection");
  } else if (connectionId && connections) {
    const match = connections.find((connection) => connection._id === connectionId);
    if (!match) {
      raise("needs_connection", "This connection was removed");
    } else if (match.status !== "active") {
      raise("reconnect", `Reconnect ${match.label || credentialLabel(match.provider)}`);
    }
  }

  for (const issue of inputIssues(definition, inputs)) {
    // The connection is already reported above, in better words than "connectionId is required".
    if (issue.path === "connectionId") continue;
    raise("incomplete", issue.message);
  }

  return state === "ready" ? READY : { state, problems };
}

/** Precedence: `unavailable` > `needs_connection` > `reconnect` > `incomplete` > `ready`. */
const RANK: Record<NodeSetupState, number> = {
  ready: 0,
  incomplete: 1,
  reconnect: 2,
  needs_connection: 3,
  unavailable: 4,
};
