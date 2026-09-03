import { describe, expect, it } from "vitest";

import { toStoredGraph, type WorkflowNodeType } from "@/components/canvas/graph-io";
import { nodeSetup, type SetupConnection } from "@/components/canvas/node-setup";

/**
 * "Does this node still need setting up?", as the canvas asks it.
 *
 * The states are the walls a run would hit, in the order they matter: the plan refuses the node at
 * all, no account is chosen, the account's token is dead, a required field is empty. Everything
 * here is about the badge on a card telling the truth *before* somebody presses Run — and about a
 * `{{ template }}` never being mistaken for a hole, since that is configuration.
 */

const PRO = ["org:pro_connectors", "pro_connectors", "ai_agent"];

function connection(overrides: Partial<SetupConnection> = {}): SetupConnection {
  return {
    _id: "conn_1",
    provider: "slack",
    kind: "oauth2",
    status: "active",
    label: "Acme workspace",
    ...overrides,
  };
}

function node(nodeType: string, inputs: Record<string, unknown> = {}) {
  return { data: { nodeType, inputs } };
}

describe("nodeSetup", () => {
  it("is ready when the plan, the connection and the form are all in order", () => {
    const setup = nodeSetup(
      node("slack.postMessage", { connectionId: "conn_1", channel: "#alerts", text: "hi" }),
      [connection()],
      PRO,
    );
    expect(setup).toEqual({ state: "ready", problems: [] });
  });

  it("asks for a connection when a Slack node has a blank connectionId", () => {
    const setup = nodeSetup(
      node("slack.postMessage", { connectionId: "", channel: "#alerts", text: "hi" }),
      [connection()],
      PRO,
    );
    expect(setup.state).toBe("needs_connection");
    expect(setup.problems).toContain("Choose a connection");
  });

  it("notices a connection that was deleted out from under the node", () => {
    const setup = nodeSetup(
      node("slack.postMessage", { connectionId: "gone", channel: "#alerts", text: "hi" }),
      [connection()],
      PRO,
    );
    expect(setup.state).toBe("needs_connection");
    expect(setup.problems).toContain("This connection was removed");
  });

  it("asks for a reconnect when the token behind a chosen connection is dead", () => {
    for (const status of ["needs_reconnect", "revoked"]) {
      const setup = nodeSetup(
        node("slack.postMessage", { connectionId: "conn_1", channel: "#alerts", text: "hi" }),
        [connection({ status })],
        PRO,
      );
      expect(setup.state).toBe("reconnect");
      expect(setup.problems).toContain("Reconnect Acme workspace");
    }
  });

  it("is incomplete while a required field is empty", () => {
    const setup = nodeSetup(node("email.send", { subject: "Hello" }), [], []);
    expect(setup.state).toBe("incomplete");
    expect(setup.problems.length).toBeGreaterThan(0);
  });

  it("does not call a {{ template }} a hole", () => {
    const setup = nodeSetup(
      node("email.send", { to: "{{ form_1.email }}", subject: "Thanks", text: "Hi" }),
      [],
      [],
    );
    expect(setup).toEqual({ state: "ready", problems: [] });
  });

  it("says a node the plan does not include is unavailable, whatever else is wrong", () => {
    const setup = nodeSetup(node("slack.postMessage", {}), [], ["free_org"]);
    expect(setup.state).toBe("unavailable");
    expect(setup.problems[0]).toBe("Not on your plan");
    // The other walls are still listed — the tooltip is the whole story, not just the first line.
    expect(setup.problems).toContain("Choose a connection");
  });

  it("checks trigger nodes too", () => {
    expect(nodeSetup(node("telegram.message", {}), [], []).state).toBe("needs_connection");
    // A trigger with no credential and nothing to fill in is simply ready.
    expect(nodeSetup(node("manual.trigger", {}), [], []).state).toBe("ready");
  });

  it("leaves an optional-credential node alone when no account is chosen", () => {
    const setup = nodeSetup(node("http.request", { url: "https://example.com" }), [], []);
    expect(setup.state).toBe("ready");
  });

  it("waits for the connections and the plan to load before dimming anything", () => {
    // `undefined` is "still loading", which is not the same as "the org has none".
    const loading = nodeSetup(
      node("slack.postMessage", { connectionId: "conn_1", channel: "#a", text: "b" }),
      undefined,
      undefined,
    );
    expect(loading.state).toBe("ready");
  });

  it("reports a node type the registry has never heard of", () => {
    expect(nodeSetup(node("nope.notANode"), [], []).state).toBe("incomplete");
  });
});

describe("setup state never reaches Convex", () => {
  it("saves only the four stored fields of a node's data", () => {
    // The canvas hands the setup down through React context rather than through node data, so
    // there is nothing to strip — this is the guard that keeps it that way.
    const nodes = [
      {
        id: "n1",
        type: "papaflow" as const,
        position: { x: 0, y: 0 },
        data: {
          nodeType: "manual.trigger",
          key: "manual_1",
          label: "Manual",
          inputs: { sample: "{}" },
          status: "success" as const,
          durationMs: 12,
        },
      },
    ] satisfies WorkflowNodeType[];

    const stored = toStoredGraph(nodes, []);
    expect(Object.keys(stored.nodes[0].data).sort()).toEqual(["inputs", "key", "label", "nodeType"]);
  });
});
