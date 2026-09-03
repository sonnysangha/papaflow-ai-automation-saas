import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EveMessage } from "eve/react";

/**
 * The Builder's pure parts: what a tool will accept, who it will work for, and how the chat panel
 * finds a parked `request_connection` in a message list.
 *
 * Nothing here opens a session, calls Convex or touches a model — these are the decisions that can
 * be wrong without anything failing loudly, so they are the ones worth pinning.
 *
 * `@/lib/billing-engine` is faked rather than automocked: the real module reaches Clerk's Backend
 * API, and what is under test is the gate, not the lookup.
 */
const { orgPlanFromClerk } = vi.hoisted(() => ({ orgPlanFromClerk: vi.fn() }));
vi.mock("@/lib/billing-engine", () => ({ orgPlanFromClerk }));

const { catalogue } = await import("@/agents/builder/lib/edits");
const { modelsFromMeta, pickConnection, pickModelId } = await import(
  "@/agents/builder/lib/models"
);
const { readIdentity, requireBuilder, requireIdentity } = await import(
  "@/agents/builder/lib/session"
);
const { CANCEL_OPTION_ID, pendingConnectionRequests, toolCallLabel } = await import(
  "@/lib/builder-protocol"
);

const addNode = (await import("@/agents/builder/tools/add_node")).default;
const connectNodes = (await import("@/agents/builder/tools/connect_nodes")).default;
const configureNode = (await import("@/agents/builder/tools/configure_node")).default;
const listNodeTypes = (await import("@/agents/builder/tools/list_node_types")).default;
const removeNodeTool = (await import("@/agents/builder/tools/remove_node")).default;
const requestConnection = (await import("@/agents/builder/tools/request_connection")).default;
const bash = (await import("@/agents/builder/tools/bash")).default;

/** A session as `agents/builder/channels/eve.ts` projects it from a verified Clerk token. */
function session(attributes: Record<string, string> | null) {
  return {
    session: { auth: { current: attributes === null ? null : { attributes } } },
  };
}

const SIGNED_IN = { orgId: "org_1", userId: "user_1", workflowId: "wf_1", plan: "pro" };

/** zod schemas reach the tool as Standard Schemas; this is how a tool's own parse is exercised. */
function parse(tool: { inputSchema: unknown }, value: unknown) {
  const schema = tool.inputSchema as { safeParse: (input: unknown) => { success: boolean } };
  return schema.safeParse(value);
}

beforeEach(() => {
  vi.clearAllMocks();
  orgPlanFromClerk.mockResolvedValue("pro");
});

describe("the Builder's session attributes", () => {
  it("reads the identity the channel projected", () => {
    expect(readIdentity(session(SIGNED_IN))).toEqual({
      orgId: "org_1",
      userId: "user_1",
      workflowId: "wf_1",
      tokenPlan: "pro",
    });
  });

  it("refuses a session with no organisation — the `localDev()` fallback under eve dev", () => {
    const result = readIdentity(session(null));
    expect(result).toHaveProperty("error");
    expect(String((result as { error: string }).error)).toContain("not signed in");
    expect(() => requireIdentity(session(null))).toThrow(/not signed in/);
  });

  it("refuses a session the panel did not bind to a workflow", () => {
    const result = readIdentity(session({ orgId: "org_1", userId: "user_1" }));
    expect(String((result as { error: string }).error)).toContain("not bound to a workflow");
  });

  it("ignores an attribute that arrived as a list rather than a string", () => {
    const odd = { session: { auth: { current: { attributes: { orgId: ["org_1"] } } } } };
    expect(readIdentity(odd)).toHaveProperty("error");
  });
});

describe("the plan gate", () => {
  it("lets a Pro organisation through, with the plan Clerk reports", async () => {
    const gated = await requireBuilder(session(SIGNED_IN));
    expect(gated.plan).toBe("pro");
    expect(gated.features).toContain("ai_builder");
    expect(orgPlanFromClerk).toHaveBeenCalledWith("org_1");
  });

  it("refuses a free organisation, whatever its session token claimed", async () => {
    orgPlanFromClerk.mockResolvedValue("free_org");
    await expect(requireBuilder(session({ ...SIGNED_IN, plan: "pro" }))).rejects.toThrow(
      /Pro feature/,
    );
  });

  it("asks Clerk rather than trusting the token's plan claim", async () => {
    orgPlanFromClerk.mockResolvedValue("free_org");
    await expect(requireBuilder(session({ ...SIGNED_IN, plan: "team" }))).rejects.toThrow();
  });
});

describe("the node catalogue a tool hands the model", () => {
  it("summarises every node without its schemas by default", () => {
    const { nodes } = catalogue(["core_connectors"]);
    expect(nodes.length).toBeGreaterThan(20);
    expect(nodes[0]).not.toHaveProperty("inputs");
    expect(nodes.find((node) => node.type === "http.request")).toBeDefined();
  });

  it("marks a node the plan cannot run rather than hiding it", () => {
    const slack = catalogue(["core_connectors"]).nodes.find(
      (node) => node.type === "slack.postMessage",
    );
    expect(slack).toMatchObject({ requiresFeature: "pro_connectors", allowed: false });
    expect(
      catalogue(["pro_connectors"]).nodes.find((node) => node.type === "slack.postMessage")?.allowed,
    ).toBe(true);
  });

  it("filters by category", () => {
    const { nodes } = catalogue(["core_connectors"], { category: "trigger" });
    expect(nodes.every((node) => node.category === "trigger")).toBe(true);
  });

  it("returns the full schemas only for the types the model asked for", () => {
    const { nodes } = catalogue(["pro_connectors"], { types: ["slack.postMessage"] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: "slack.postMessage", credential: "slack" });
    expect(nodes[0]).toHaveProperty("inputs");
    expect(nodes[0]).toHaveProperty("outputs");
  });

  it("carries a Logic node's own explanation of its handles, at that depth only", () => {
    const { nodes } = catalogue(["core_connectors"], { types: ["logic.loop"] });
    // `handles` says a Loop has `each` and `done`; the guide says which one the body hangs off.
    expect(nodes[0]).toMatchObject({
      handles: ["each", "done"],
      guide: { outputs: { each: "each item", done: "when done" } },
    });
    // The browse listing stays one line per node: twenty-eight paragraphs is not a summary.
    expect(catalogue(["core_connectors"]).nodes[0]).not.toHaveProperty("guide");
  });

  it("says so when every requested type is imaginary", () => {
    expect(() => catalogue(["pro_connectors"], { types: ["slack.postMesage"] })).toThrow(
      /No such node type/,
    );
  });
});

describe("tool input schemas", () => {
  it("add_node wants a type and takes optional configuration", () => {
    expect(parse(addNode, { type: "http.request" }).success).toBe(true);
    expect(parse(addNode, { type: "http.request", inputs: { url: "x" } }).success).toBe(true);
    expect(parse(addNode, {}).success).toBe(false);
  });

  it("connect_nodes wants both ends", () => {
    expect(parse(connectNodes, { from: "a", to: "b" }).success).toBe(true);
    expect(parse(connectNodes, { from: "a", to: "b", sourceHandle: "true" }).success).toBe(true);
    expect(parse(connectNodes, { from: "a" }).success).toBe(false);
  });

  it("configure_node wants a node and an object of inputs", () => {
    expect(parse(configureNode, { node: "a", inputs: { text: "hi" } }).success).toBe(true);
    expect(parse(configureNode, { node: "a" }).success).toBe(false);
    expect(parse(configureNode, { node: "a", inputs: "hi" }).success).toBe(false);
  });

  it("list_node_types takes nothing, a category, or a list of types", () => {
    expect(parse(listNodeTypes, {}).success).toBe(true);
    expect(parse(listNodeTypes, { category: "trigger" }).success).toBe(true);
    expect(parse(listNodeTypes, { category: "nonsense" }).success).toBe(false);
  });

  it("request_connection wants a provider and a reason to show the user", () => {
    expect(parse(requestConnection, { provider: "slack", reason: "to post" }).success).toBe(true);
    expect(parse(requestConnection, { provider: "slack" }).success).toBe(false);
  });

  it("remove_node is the only tool that asks the user first", () => {
    expect(parse(removeNodeTool, { node: "http_request_1" }).success).toBe(true);
    expect(removeNodeTool.approval).toBeDefined();
    expect(addNode).not.toHaveProperty("approval");
  });

  it("the shell, filesystem, fetch and subagent tools are disabled", () => {
    // `disableTool()` returns eve's sentinel rather than a definition, so the shape is the assertion.
    expect(bash).not.toHaveProperty("execute");
  });
});

/* -------------------------------------------------------------------------------------------------
 * The chat panel's pending-ask detection.
 * ---------------------------------------------------------------------------------------------- */

type Part = EveMessage["parts"][number];

function toolPart(overrides: Partial<Record<string, unknown>>): Part {
  return {
    type: "dynamic-tool",
    toolCallId: "call_1",
    toolName: "request_connection",
    state: "approval-requested",
    input: { provider: "notion" },
    approval: { id: "appr_1" },
    toolMetadata: {
      eve: {
        kind: "tool-call",
        name: "request_connection",
        inputRequest: {
          requestId: "req_1",
          kind: "question",
          prompt: "PapaFlow needs a Notion connection.",
          display: "confirmation",
          allowFreeform: true,
          options: [
            { id: "conn_existing", label: 'Use "Team wiki"' },
            { id: CANCEL_OPTION_ID, label: "Not now" },
          ],
        },
      },
    },
    ...overrides,
  } as Part;
}

function message(parts: Part[], id = "m1"): EveMessage {
  return { id, role: "assistant", parts } as EveMessage;
}

describe("pendingConnectionRequests", () => {
  it("finds a parked request_connection and reads the provider off the tool's own input", () => {
    const pending = pendingConnectionRequests([message([toolPart({})])]);
    expect(pending).toEqual([
      {
        requestId: "req_1",
        provider: "notion",
        prompt: "PapaFlow needs a Notion connection.",
        options: [{ id: "conn_existing", label: 'Use "Team wiki"' }],
      },
    ]);
  });

  it("drops the cancel option — the widget renders its own", () => {
    const [pending] = pendingConnectionRequests([message([toolPart({})])]);
    expect(pending.options.map((option) => option.id)).not.toContain(CANCEL_OPTION_ID);
  });

  it("ignores a tool call that is not waiting on anything", () => {
    expect(
      pendingConnectionRequests([
        message([toolPart({ state: "output-available", output: {}, approval: undefined })]),
      ]),
    ).toEqual([]);
  });

  it("ignores an approval for another tool — remove_node is matched by toolName, not by kind", () => {
    expect(
      pendingConnectionRequests([message([toolPart({ toolName: "remove_node" })])]),
    ).toEqual([]);
  });

  it("scans every message, because a later turn can be added while an ask stays open", () => {
    const pending = pendingConnectionRequests([
      message([{ type: "text", text: "Adding the trigger…", state: "done" } as Part], "m0"),
      message([toolPart({})], "m1"),
      message([{ type: "text", text: "…", state: "streaming" } as Part], "m2"),
    ]);
    expect(pending).toHaveLength(1);
  });

  it("survives a part with no input request at all", () => {
    expect(
      pendingConnectionRequests([message([toolPart({ toolMetadata: undefined })])]),
    ).toEqual([]);
    expect(pendingConnectionRequests([])).toEqual([]);
  });
});

describe("toolCallLabel", () => {
  it("says what happened, in the user's words", () => {
    expect(toolCallLabel("add_node", { type: "http.request", label: "HTTP Request" })).toBe(
      "Added HTTP Request",
    );
    expect(toolCallLabel("connect_nodes", { from: "manual_trigger_1", to: "http_request_1" })).toBe(
      "Connected manual_trigger_1 → http_request_1",
    );
    expect(
      toolCallLabel("connect_nodes", { from: "cond_1", to: "slack_1", sourceHandle: "true" }),
    ).toBe("Connected cond_1 → slack_1 (true)");
    expect(toolCallLabel("request_connection", { provider: "notion" })).toBe(
      "Asked for a notion connection",
    );
  });

  it("falls back to the tool's own name for anything it has no words for", () => {
    expect(toolCallLabel("load_skill", { name: "chat" })).toBe("load_skill");
    expect(toolCallLabel("add_node", null)).toBe("Added a node");
  });
});

describe("which model the Builder thinks with", () => {
  it("prefers the most capable provider the organisation has connected", () => {
    const chosen = pickConnection([
      { provider: "groq", status: "active" },
      { provider: "anthropic", status: "active" },
    ]);
    expect(chosen?.connection.provider).toBe("anthropic");
  });

  it("skips a connection that needs reconnecting", () => {
    const chosen = pickConnection([
      { provider: "anthropic", status: "needs_reconnect" },
      { provider: "openai", status: "active" },
    ]);
    expect(chosen?.connection.provider).toBe("openai");
  });

  it("has nothing to say about a workspace with no AI connection", () => {
    expect(pickConnection([])).toBeNull();
  });

  it("picks a model id from what the provider itself reported, never from a hardcoded name", () => {
    const models = ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1"];
    expect(pickModelId(models, ["opus", "sonnet"])).toBe("claude-opus-4-1");
    expect(pickModelId(models, ["sonnet"])).toBe("claude-sonnet-4-5");
    expect(pickModelId(models, ["nothing-like-this"])).toBe("claude-haiku-4-5");
    expect(pickModelId([], ["opus"])).toBeNull();
  });

  it("reads the model list a connector captured at connect time", () => {
    expect(modelsFromMeta({ models: ["a", "b"] })).toEqual(["a", "b"]);
    expect(modelsFromMeta({ models: "not a list" })).toEqual([]);
    expect(modelsFromMeta(undefined)).toEqual([]);
  });
});
