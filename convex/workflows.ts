import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireOrg } from "./lib/auth";
import { currentPlan } from "./lib/plan";
import schema from "./schema";

/**
 * The canvas graph as it is stored on `workflows.graph`. Nodes and edges stay `v.any()` on purpose:
 * React Flow owns their shape and the node registry validates `data.inputs` at run time. Exported so
 * the engine and the Builder agent can reuse it in later phases.
 */
export const graphValidator = v.object({
  nodes: v.array(v.any()),
  edges: v.array(v.any()),
  viewport: v.optional(v.any()),
  triggerId: v.optional(v.string()),
});

/** What the list page needs — deliberately not the whole document (no graph, no webhook secret). */
const workflowSummary = v.object({
  _id: v.id("workflows"),
  _creationTime: v.number(),
  name: v.string(),
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
  version: v.number(),
  updatedAt: v.number(),
});

const WEBHOOK_SECRET_LENGTH = 32;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * 32 base64url characters of entropy for the workflow's webhook URL (Phase 5). The Convex runtime
 * provides Web Crypto; the `Math.random` branch only exists so a missing `crypto` can never block a
 * create, and would need replacing before webhooks ship if it ever fires.
 */
function randomWebhookSecret(): string {
  try {
    const bytes = new Uint8Array(WEBHOOK_SECRET_LENGTH);
    crypto.getRandomValues(bytes);
    let secret = "";
    for (const byte of bytes) secret += BASE64URL[byte & 63];
    return secret;
  } catch {
    console.warn("crypto.getRandomValues unavailable; falling back to Math.random");
    let secret = "";
    while (secret.length < WEBHOOK_SECRET_LENGTH) {
      secret += Math.floor(Math.random() * 16).toString(16);
    }
    return secret.slice(0, WEBHOOK_SECRET_LENGTH);
  }
}

/**
 * Loads a workflow and proves it belongs to the caller's organisation. A row from another org is
 * indistinguishable from one that never existed, so this never leaks ids across organisations.
 */
async function workflowInOrg(
  ctx: QueryCtx,
  id: Id<"workflows">,
  orgId: string,
): Promise<Doc<"workflows">> {
  const workflow = await ctx.db.get(id);
  if (!workflow || workflow.orgId !== orgId) throw new ConvexError({ code: "not_found" });
  return workflow;
}

/** The active organisation's workflows, newest first. */
export const list = query({
  args: {},
  returns: v.array(workflowSummary),
  handler: async (ctx) => {
    const { orgId } = await requireOrg(ctx);

    const workflows = await ctx.db
      .query("workflows")
      .withIndex("by_org_updated", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();

    return workflows.map((workflow) => ({
      _id: workflow._id,
      _creationTime: workflow._creationTime,
      name: workflow.name,
      status: workflow.status,
      version: workflow.version,
      updatedAt: workflow.updatedAt,
    }));
  },
});

/** One workflow, including its graph. Throws `not_found` unless it belongs to the active org. */
export const get = query({
  args: { id: v.id("workflows") },
  returns: schema.doc("workflows"),
  handler: async (ctx, { id }) => {
    const { orgId } = await requireOrg(ctx);
    return await workflowInOrg(ctx, id, orgId);
  },
});

/** Creates an empty draft. Refuses with `plan_limit` when the org is at its plan's workflow cap. */
export const create = mutation({
  args: { name: v.string() },
  returns: v.id("workflows"),
  handler: async (ctx, { name }) => {
    const { userId, orgId } = await requireOrg(ctx);
    const { limits } = await currentPlan(ctx);

    // `Infinity` means unlimited; otherwise take at most `limit` rows just to count them.
    const limit = limits.workflows;
    if (Number.isFinite(limit)) {
      const existing = await ctx.db
        .query("workflows")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .take(limit);
      if (existing.length >= limit) throw new ConvexError({ code: "plan_limit", limit });
    }

    return await ctx.db.insert("workflows", {
      orgId,
      createdBy: userId,
      name: name.trim() || "Untitled workflow",
      graph: { nodes: [], edges: [] },
      version: 1,
      status: "draft",
      webhookSecret: randomWebhookSecret(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Replaces the graph with optimistic concurrency: the caller sends the version it last saw and gets
 * the new one back. A mismatch throws `version_conflict` with the version the caller should adopt.
 */
export const saveGraph = mutation({
  args: {
    id: v.id("workflows"),
    graph: graphValidator,
    expectedVersion: v.number(),
  },
  returns: v.object({ version: v.number() }),
  handler: async (ctx, { id, graph, expectedVersion }) => {
    const { userId, orgId } = await requireOrg(ctx);
    const workflow = await workflowInOrg(ctx, id, orgId);

    if (workflow.version !== expectedVersion) {
      throw new ConvexError({ code: "version_conflict", version: workflow.version });
    }

    const version = workflow.version + 1;
    await ctx.db.patch(id, {
      graph,
      version,
      lastEditSource: "canvas",
      lastEditedBy: userId,
      updatedAt: Date.now(),
    });

    return { version };
  },
});

/** Renames a workflow. Does not touch the graph version — only `saveGraph` moves that. */
export const rename = mutation({
  args: { id: v.id("workflows"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, id, orgId);

    await ctx.db.patch(id, { name: name.trim() || "Untitled workflow", updatedAt: Date.now() });
    return null;
  },
});

/** Deletes a workflow. Executions and steps are left alone; Phase 2 decides their retention. */
export const remove = mutation({
  args: { id: v.id("workflows") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { orgId } = await requireOrg(ctx);
    await workflowInOrg(ctx, id, orgId);

    await ctx.db.delete(id);
    return null;
  },
});
