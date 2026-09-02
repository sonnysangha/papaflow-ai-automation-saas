import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { graphValidator } from "./workflows";

/**
 * The Builder agent's write surface.
 *
 * The agent runs inside the eve service with no Clerk session, so — like `convex/engine.ts` — every
 * function here is public but proves it is ours with `ENGINE_SECRET` before delegating to an
 * internal one (CLAUDE.md rule 5). `orgId` and `userId` travel with each call and are re-checked
 * against the row being touched, so a workflow belonging to another organisation is indistinguishable
 * from one that never existed.
 *
 * **Why the node registry is not imported here.** `nodes/registry.ts` reaches `@/…` path aliases,
 * `@ai-sdk/*` provider factories and `eve/client` through the nodes it collects; none of that
 * belongs in a Convex bundle, and `convex/engine.ts` already refuses the same import (it matches
 * trigger types by string literal instead). So the split is:
 *
 * - **zod validation of a node's inputs happens in the Builder tool**, against the node's own
 *   schema (`lib/validate-workflow.ts#inputIssues`), before the mutation is called;
 * - **structural validation happens here**: the workflow is this org's, the node exists, keys stay
 *   unique and template-shaped, an edge joins two nodes that exist and is not a duplicate.
 *
 * Every write bumps `version` and stamps `lastEditSource: "builder"`, which is what makes an open
 * canvas adopt the change instead of fighting it (`components/canvas/Canvas.tsx`).
 */
function guard(secret: string): void {
  const expected = process.env.ENGINE_SECRET;
  if (!expected || secret !== expected) throw new ConvexError({ code: "unauthorized" });
}

/** The shape a node key must have to be usable in a template: `{{ http_request_1.body }}`. */
const NODE_KEY = /^[a-z][a-z0-9_]*$/;

/** Horizontal spacing of auto-placed nodes; the Builder draws a chain and the user rearranges it. */
const COLUMN_WIDTH = 280;
const ROW_Y = 160;
const FIRST_X = 80;

type StoredGraph = Doc<"workflows">["graph"];

type BuilderNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { nodeType: string; key: string; label: string; inputs: Record<string, unknown> };
};

type BuilderEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

/** The React Flow node type the canvas renders (`components/canvas/graph-io.ts`). */
const PAPAFLOW_NODE_TYPE = "papaflow";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Stored nodes, defensively — `workflows.graph.nodes` is `v.any()` and may predate any field. */
function readNodes(graph: StoredGraph): BuilderNode[] {
  const nodes: BuilderNode[] = [];
  for (const entry of graph.nodes) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    const data = isRecord(entry.data) ? entry.data : {};
    const nodeType = str(data.nodeType);
    if (!id || !nodeType) continue;
    const position = isRecord(entry.position) ? entry.position : {};
    nodes.push({
      id,
      type: str(entry.type) ?? PAPAFLOW_NODE_TYPE,
      position: {
        x: typeof position.x === "number" ? position.x : 0,
        y: typeof position.y === "number" ? position.y : 0,
      },
      data: {
        nodeType,
        key: str(data.key) ?? "",
        label: str(data.label) ?? nodeType,
        inputs: isRecord(data.inputs) ? data.inputs : {},
      },
    });
  }
  return nodes;
}

function readEdges(graph: StoredGraph): BuilderEdge[] {
  const edges: BuilderEdge[] = [];
  for (const entry of graph.edges) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id);
    const source = str(entry.source);
    const target = str(entry.target);
    if (!id || !source || !target) continue;
    edges.push({
      id,
      source,
      target,
      ...(str(entry.sourceHandle) ? { sourceHandle: str(entry.sourceHandle) as string } : {}),
      ...(str(entry.targetHandle) ? { targetHandle: str(entry.targetHandle) as string } : {}),
    });
  }
  return edges;
}

/**
 * `http.request` → `http_request_1`, with the smallest free number, exactly as the canvas names a
 * dropped node (`components/canvas/graph-io.ts#nextKey`). The rule is duplicated rather than
 * imported because that module is browser code and this one runs in Convex — but the two have to
 * agree, or a template written against a Builder-placed node would stop resolving the moment the
 * canvas re-saved the graph.
 */
function keyFor(nodeType: string, taken: ReadonlySet<string>): string {
  const base = nodeType.replace(/\./g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const prefix = NODE_KEY.test(base) ? base : `n_${base}`;
  for (let n = 1; ; n++) {
    const key = `${prefix}_${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * A fresh node or edge id. 128 bits of hex from the same `crypto.getRandomValues` the webhook
 * secret uses (`convex/workflows.ts`) — ids only have to be unique inside one graph, and the
 * canvas is happy with any string.
 */
function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) id += byte.toString(16).padStart(2, "0");
  return id;
}

/** Loads a workflow and proves it is this organisation's. */
async function workflowInOrg(
  ctx: MutationCtx,
  workflowId: Id<"workflows">,
  orgId: string,
): Promise<Doc<"workflows">> {
  const workflow = await ctx.db.get(workflowId);
  if (!workflow || workflow.orgId !== orgId) throw new ConvexError({ code: "not_found" });
  return workflow;
}

/** A node by its id or by its template key, whichever the agent used. */
function findNode(nodes: readonly BuilderNode[], reference: string): BuilderNode | undefined {
  return nodes.find((node) => node.id === reference) ?? nodes.find((node) => node.data.key === reference);
}

/** Writes the edited graph back: one version bump, stamped as the Builder's edit. */
async function commit(
  ctx: MutationCtx,
  workflow: Doc<"workflows">,
  graph: StoredGraph,
  userId: string,
): Promise<number> {
  const version = workflow.version + 1;
  await ctx.db.patch(workflow._id, {
    graph,
    version,
    lastEditSource: "builder",
    lastEditedBy: userId,
    updatedAt: Date.now(),
  });
  return version;
}

/* -------------------------------------------------------------------------------------------------
 * Reads.
 * ---------------------------------------------------------------------------------------------- */

type BuilderGraphResult = {
  name: string;
  status: Doc<"workflows">["status"];
  version: number;
  graph: StoredGraph;
} | null;

const builderGraphResult = v.union(
  v.object({
    name: v.string(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
    version: v.number(),
    graph: graphValidator,
  }),
  v.null(),
);

export const graphForBuilder = internalQuery({
  args: { workflowId: v.id("workflows"), orgId: v.string() },
  returns: builderGraphResult,
  handler: async (ctx, { workflowId, orgId }) => {
    const workflow = await ctx.db.get(workflowId);
    if (!workflow || workflow.orgId !== orgId) return null;
    return {
      name: workflow.name,
      status: workflow.status,
      version: workflow.version,
      graph: workflow.graph,
    };
  },
});

/** The graph the Builder is editing, or null when it is not this organisation's. */
export const getGraph = query({
  args: { secret: v.string(), workflowId: v.id("workflows"), orgId: v.string() },
  returns: builderGraphResult,
  handler: async (ctx, { secret, ...args }): Promise<BuilderGraphResult> => {
    guard(secret);
    return await ctx.runQuery(internal.builder.graphForBuilder, args);
  },
});

/* -------------------------------------------------------------------------------------------------
 * Writes.
 * ---------------------------------------------------------------------------------------------- */

const editArgs = {
  workflowId: v.id("workflows"),
  orgId: v.string(),
  userId: v.string(),
};

const addNodeResult = v.object({ nodeId: v.string(), key: v.string(), version: v.number() });

export const addNodeInternal = internalMutation({
  args: {
    ...editArgs,
    nodeType: v.string(),
    label: v.string(),
    inputs: v.any(),
    /** Whether this node's definition is in the `trigger` category — the registry lives in the tool. */
    isTrigger: v.boolean(),
  },
  returns: addNodeResult,
  handler: async (ctx, { workflowId, orgId, userId, nodeType, label, inputs, isTrigger }) => {
    const workflow = await workflowInOrg(ctx, workflowId, orgId);
    const nodes = readNodes(workflow.graph);

    if (isTrigger) {
      // Two triggers make `toRunGraph` pick one arbitrarily, so the refusal happens before the
      // write rather than in `validate_workflow` afterwards.
      const existing = nodes.find((node) => node.id === str(workflow.graph.triggerId));
      if (existing) {
        throw new ConvexError({
          code: "trigger_exists",
          message: `This workflow already starts with ${existing.data.key || existing.data.nodeType}. Remove it before adding another trigger.`,
        });
      }
    }

    const key = keyFor(nodeType, new Set(nodes.map((node) => node.data.key)));
    const x = nodes.length === 0 ? FIRST_X : Math.max(...nodes.map((node) => node.position.x)) + COLUMN_WIDTH;
    const node: BuilderNode = {
      id: newId(),
      type: PAPAFLOW_NODE_TYPE,
      position: { x, y: ROW_Y },
      data: { nodeType, key, label: label || nodeType, inputs: isRecord(inputs) ? inputs : {} },
    };

    const graph: StoredGraph = {
      ...workflow.graph,
      nodes: [...workflow.graph.nodes, node],
      ...(isTrigger ? { triggerId: node.id } : {}),
    };

    const version = await commit(ctx, workflow, graph, userId);
    return { nodeId: node.id, key, version };
  },
});

/** Appends one node and returns the id and template key the agent should use from now on. */
export const addNode = mutation({
  args: {
    secret: v.string(),
    ...editArgs,
    nodeType: v.string(),
    label: v.string(),
    inputs: v.any(),
    isTrigger: v.boolean(),
  },
  returns: addNodeResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof addNodeResult.type> => {
    guard(secret);
    return await ctx.runMutation(internal.builder.addNodeInternal, args);
  },
});

const connectResult = v.object({ edgeId: v.string(), version: v.number() });

export const connectNodesInternal = internalMutation({
  args: { ...editArgs, from: v.string(), to: v.string(), sourceHandle: v.optional(v.string()) },
  returns: connectResult,
  handler: async (ctx, { workflowId, orgId, userId, from, to, sourceHandle }) => {
    const workflow = await workflowInOrg(ctx, workflowId, orgId);
    const nodes = readNodes(workflow.graph);

    const source = findNode(nodes, from);
    const target = findNode(nodes, to);
    if (!source) throw new ConvexError({ code: "node_not_found", message: `There is no node "${from}".` });
    if (!target) throw new ConvexError({ code: "node_not_found", message: `There is no node "${to}".` });
    if (source.id === target.id) {
      throw new ConvexError({ code: "invalid_edge", message: "A node cannot be wired to itself." });
    }

    const edges = readEdges(workflow.graph);
    const duplicate = edges.find(
      (edge) =>
        edge.source === source.id &&
        edge.target === target.id &&
        (edge.sourceHandle ?? null) === (sourceHandle ?? null),
    );
    if (duplicate) {
      throw new ConvexError({
        code: "edge_exists",
        message: `${source.data.key} is already connected to ${target.data.key}.`,
      });
    }

    const edge: BuilderEdge = {
      id: newId(),
      source: source.id,
      target: target.id,
      ...(sourceHandle ? { sourceHandle } : {}),
    };

    const graph: StoredGraph = { ...workflow.graph, edges: [...workflow.graph.edges, edge] };
    const version = await commit(ctx, workflow, graph, userId);
    return { edgeId: edge.id, version };
  },
});

/** Wires one node's output into another's input. `sourceHandle` picks a branch (`true`, `each`, …). */
export const connectNodes = mutation({
  args: {
    secret: v.string(),
    ...editArgs,
    from: v.string(),
    to: v.string(),
    sourceHandle: v.optional(v.string()),
  },
  returns: connectResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof connectResult.type> => {
    guard(secret);
    return await ctx.runMutation(internal.builder.connectNodesInternal, args);
  },
});

const configureResult = v.object({
  nodeId: v.string(),
  key: v.string(),
  inputs: v.any(),
  version: v.number(),
});

export const configureNodeInternal = internalMutation({
  args: { ...editArgs, node: v.string(), inputs: v.any(), label: v.optional(v.string()) },
  returns: configureResult,
  handler: async (ctx, { workflowId, orgId, userId, node: reference, inputs, label }) => {
    const workflow = await workflowInOrg(ctx, workflowId, orgId);
    const nodes = readNodes(workflow.graph);
    const target = findNode(nodes, reference);
    if (!target) {
      throw new ConvexError({ code: "node_not_found", message: `There is no node "${reference}".` });
    }
    if (!isRecord(inputs)) {
      throw new ConvexError({ code: "invalid_inputs", message: "inputs must be an object." });
    }

    // A merge, not a replacement: the agent configures one field at a time, and a second call must
    // not wipe the connection the first one set.
    const merged = { ...target.data.inputs, ...inputs };

    const updated = workflow.graph.nodes.map((entry) => {
      if (!isRecord(entry) || entry.id !== target.id) return entry;
      const data = isRecord(entry.data) ? entry.data : {};
      return {
        ...entry,
        data: { ...data, inputs: merged, ...(label ? { label } : {}) },
      };
    });

    const graph: StoredGraph = { ...workflow.graph, nodes: updated };
    const version = await commit(ctx, workflow, graph, userId);
    return { nodeId: target.id, key: target.data.key, inputs: merged, version };
  },
});

/** Merges configuration into one node. Existing fields the call does not mention are kept. */
export const configureNode = mutation({
  args: {
    secret: v.string(),
    ...editArgs,
    node: v.string(),
    inputs: v.any(),
    label: v.optional(v.string()),
  },
  returns: configureResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof configureResult.type> => {
    guard(secret);
    return await ctx.runMutation(internal.builder.configureNodeInternal, args);
  },
});

const removeResult = v.object({
  nodeId: v.string(),
  key: v.string(),
  removedEdges: v.number(),
  version: v.number(),
});

export const removeNodeInternal = internalMutation({
  args: { ...editArgs, node: v.string() },
  returns: removeResult,
  handler: async (ctx, { workflowId, orgId, userId, node: reference }) => {
    const workflow = await workflowInOrg(ctx, workflowId, orgId);
    const nodes = readNodes(workflow.graph);
    const target = findNode(nodes, reference);
    if (!target) {
      throw new ConvexError({ code: "node_not_found", message: `There is no node "${reference}".` });
    }

    const edges = readEdges(workflow.graph);
    const removedEdges = edges.filter(
      (edge) => edge.source === target.id || edge.target === target.id,
    ).length;

    const graph: StoredGraph = {
      ...workflow.graph,
      nodes: workflow.graph.nodes.filter((entry) => !isRecord(entry) || entry.id !== target.id),
      edges: workflow.graph.edges.filter(
        (entry) => !isRecord(entry) || (entry.source !== target.id && entry.target !== target.id),
      ),
    };
    // The trigger went with it. `toRunGraph` falls back to "the first node in the trigger category"
    // when there is no `triggerId`, so clearing it is safe even without the node registry here.
    if (graph.triggerId === target.id) delete graph.triggerId;

    const version = await commit(ctx, workflow, graph, userId);
    return { nodeId: target.id, key: target.data.key, removedEdges, version };
  },
});

/** Deletes a node and every edge touching it. The tool gates this behind a human approval. */
export const removeNode = mutation({
  args: { secret: v.string(), ...editArgs, node: v.string() },
  returns: removeResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof removeResult.type> => {
    guard(secret);
    return await ctx.runMutation(internal.builder.removeNodeInternal, args);
  },
});

const activateResult = v.object({
  name: v.string(),
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
  version: v.number(),
});

export const activateInternal = internalMutation({
  args: editArgs,
  returns: activateResult,
  handler: async (ctx, { workflowId, orgId, userId }) => {
    const workflow = await workflowInOrg(ctx, workflowId, orgId);
    // Not a graph edit: the version stays put so no open canvas has anything to adopt.
    await ctx.db.patch(workflowId, {
      status: "active",
      lastEditedBy: userId,
      updatedAt: Date.now(),
    });
    return { name: workflow.name, status: "active" as const, version: workflow.version };
  },
});

/** Marks the workflow active — what `finish` does once `validate_workflow` came back clean. */
export const activate = mutation({
  args: { secret: v.string(), ...editArgs },
  returns: activateResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof activateResult.type> => {
    guard(secret);
    return await ctx.runMutation(internal.builder.activateInternal, args);
  },
});

/* -------------------------------------------------------------------------------------------------
 * Builder sessions.
 *
 * One row per (workflow, user) chat: the route creates it before the panel opens a session, and the
 * panel reports the eve session id back once it knows one, so a reload can resume the conversation.
 * ---------------------------------------------------------------------------------------------- */

const sessionResult = v.object({ builderSessionId: v.id("builderSessions"), eveSessionId: v.string() });

export const startSessionInternal = internalMutation({
  args: { workflowId: v.id("workflows"), orgId: v.string(), userId: v.string() },
  returns: sessionResult,
  handler: async (ctx, { workflowId, orgId, userId }) => {
    await workflowInOrg(ctx, workflowId, orgId);

    const existing = await ctx.db
      .query("builderSessions")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .collect();
    const mine = existing.find(
      (row) => row.userId === userId && row.orgId === orgId && row.status === "active",
    );

    if (mine) {
      await ctx.db.patch(mine._id, { updatedAt: Date.now() });
      return { builderSessionId: mine._id, eveSessionId: mine.eveSessionId };
    }

    const now = Date.now();
    const builderSessionId = await ctx.db.insert("builderSessions", {
      orgId,
      userId,
      workflowId,
      eveSessionId: "",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { builderSessionId, eveSessionId: "" };
  },
});

/** Reuses this user's open chat for this workflow, or opens one. */
export const startSession = mutation({
  args: { secret: v.string(), workflowId: v.id("workflows"), orgId: v.string(), userId: v.string() },
  returns: sessionResult,
  handler: async (ctx, { secret, ...args }): Promise<typeof sessionResult.type> => {
    guard(secret);
    return await ctx.runMutation(internal.builder.startSessionInternal, args);
  },
});

export const attachEveSessionInternal = internalMutation({
  args: {
    builderSessionId: v.id("builderSessions"),
    orgId: v.string(),
    userId: v.string(),
    eveSessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { builderSessionId, orgId, userId, eveSessionId }) => {
    const row = await ctx.db.get(builderSessionId);
    if (!row || row.orgId !== orgId || row.userId !== userId) {
      throw new ConvexError({ code: "not_found" });
    }
    await ctx.db.patch(builderSessionId, { eveSessionId, updatedAt: Date.now() });
    return null;
  },
});

/** Records the eve session id the panel learned, so a reload can resume the same conversation. */
export const attachEveSession = mutation({
  args: {
    secret: v.string(),
    builderSessionId: v.id("builderSessions"),
    orgId: v.string(),
    userId: v.string(),
    eveSessionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    guard(secret);
    await ctx.runMutation(internal.builder.attachEveSessionInternal, args);
    return null;
  },
});
