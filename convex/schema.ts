import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Every table carries orgId (Clerk organisation id) and is indexed by it. createdBy is informational.
const sealed = v.object({ v: v.literal(1), keyId: v.string(), iv: v.string(), tag: v.string(), ct: v.string() });
const executionStatus = v.union(
  v.literal("queued"), v.literal("running"), v.literal("waiting"),
  v.literal("completed"), v.literal("failed"), v.literal("cancelled"),
);
const stepStatus = v.union(
  v.literal("running"), v.literal("success"), v.literal("failed"), v.literal("waiting"), v.literal("skipped"),
);

export default defineSchema({
  // Organisations, memberships and plans are NOT mirrored here: Clerk is the source of truth and
  // the session token carries the org id, role, plan (`pla`) and features (`fea`). See convex/lib/auth.ts.

  workflows: defineTable({
    orgId: v.string(),
    createdBy: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    graph: v.object({
      nodes: v.array(v.any()),
      edges: v.array(v.any()),
      viewport: v.optional(v.any()),
      triggerId: v.optional(v.string()),
    }),
    version: v.number(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
    webhookSecret: v.string(),
    lastEditSource: v.optional(v.union(v.literal("canvas"), v.literal("builder"))),
    lastEditedBy: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_updated", ["orgId", "updatedAt"]),

  executions: defineTable({
    orgId: v.string(),
    workflowId: v.id("workflows"),
    workflowVersion: v.number(),
    // The org's Clerk plan at the moment the run started. Snapshotted because the engine has no
    // session and plans change: usage limits and history retention are judged against this value.
    planSlug: v.string(),
    status: executionStatus,
    trigger: v.object({ type: v.string(), payload: v.any() }),
    runId: v.optional(v.string()),
    startedBy: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_workflow", ["workflowId"])
    .index("by_runId", ["runId"])
    .index("by_org_started", ["orgId", "startedAt"]),

  steps: defineTable({
    orgId: v.string(),
    executionId: v.id("executions"),
    nodeId: v.string(),
    nodeType: v.string(),
    status: stepStatus,
    attempt: v.number(),
    input: v.optional(v.any()),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    // Templates that resolved to nothing (`"{{ a.b }}: not found"`). Not an error: the node ran
    // with "" where the reference was, and the canvas shows these on the step.
    warnings: v.optional(v.array(v.string())),
    handle: v.optional(v.string()),
    hookToken: v.optional(v.string()),
    // The 0-based pass a Loop body node is on, absent for every node that runs once. It is part of
    // the row's identity: `by_execution_node` includes it, so pass 2 gets its own row instead of
    // overwriting pass 1 — and so `runNode`'s "already succeeded" guard cannot short-circuit an
    // iteration with the previous one's output.
    iteration: v.optional(v.number()),
    parentStepId: v.optional(v.id("steps")),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_execution", ["executionId"])
    .index("by_execution_node", ["executionId", "nodeId", "iteration"])
    .index("by_org", ["orgId"])
    .index("by_hookToken", ["hookToken"]),

  connections: defineTable({
    orgId: v.string(),
    createdBy: v.string(),
    provider: v.string(),
    kind: v.union(
      v.literal("apiKey"), v.literal("oauth2"), v.literal("webhookUrl"),
      v.literal("botToken"), v.literal("signingSecret"),
    ),
    label: v.string(),
    secret: sealed,
    hint: v.string(),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    meta: v.any(),
    status: v.union(v.literal("active"), v.literal("needs_reconnect"), v.literal("revoked")),
    requiresFeature: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_provider", ["orgId", "provider"]),

  schedules: defineTable({
    orgId: v.string(),
    workflowId: v.id("workflows"),
    cron: v.string(),
    timezone: v.optional(v.string()),
    enabled: v.boolean(),
    runId: v.optional(v.string()),
    nextAt: v.optional(v.number()),
    lastFiredAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_workflow", ["workflowId"]),

  usage: defineTable({
    orgId: v.string(),
    month: v.string(), // "2026-09"
    runs: v.number(),
    builderTurns: v.number(),
    houseModelCalls: v.number(),
  }).index("by_org_month", ["orgId", "month"]),

  oauthStates: defineTable({
    orgId: v.string(),
    userId: v.string(),
    provider: v.string(),
    state: v.string(),
    codeVerifier: v.optional(v.string()),
    redirectTo: v.optional(v.string()),
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expiresAt", ["expiresAt"]),

  builderSessions: defineTable({
    orgId: v.string(),
    userId: v.string(),
    workflowId: v.id("workflows"),
    eveSessionId: v.string(),
    status: v.union(v.literal("active"), v.literal("finished"), v.literal("cancelled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_workflow", ["workflowId"])
    .index("by_eveSessionId", ["eveSessionId"]),

  // Dedupe store for Clerk (svix-id), Stripe (event.id) and GitHub (delivery id) deliveries.
  webhookEvents: defineTable({
    source: v.string(),
    eventId: v.string(),
    receivedAt: v.number(),
  }).index("by_source_event", ["source", "eventId"]),
});
