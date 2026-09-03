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
    // The two the runs pages scan: `startedAt` is the sort key *and* the retention cutoff, so a
    // plan's history window is a range on the index rather than a filter over a page of rows.
    .index("by_org_started", ["orgId", "startedAt"])
    .index("by_workflow_started", ["workflowId", "startedAt"]),

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
    // The provider's own id for the account behind this credential — Slack's `team_id`, later a
    // Discord `application_id`. It is a copy of one key of `meta` (the connector says which, via
    // `ConnectorDef.externalIdFrom`) promoted to a column, because `meta` is `v.any()` and Convex
    // cannot index inside it: `POST /api/events/slack` holds nothing but a workspace id and has to
    // find the connections it could belong to. Optional because most providers have no such id,
    // and because rows created before this column existed simply do not have one.
    externalId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    meta: v.any(),
    status: v.union(v.literal("active"), v.literal("needs_reconnect"), v.literal("revoked")),
    requiresFeature: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_provider", ["orgId", "provider"])
    // Deliberately not org-scoped: an inbound delivery names a workspace, never an organisation.
    // The `provider` prefix also makes the legacy `meta.team_id` scan an indexed range rather than
    // a table scan (`connections.idsByMetaValue`).
    .index("by_provider_external", ["provider", "externalId"]),

  // Convex is the alarm clock: one durable scheduled job per published schedule, which wakes and
  // asks the Next app to start the run (`internal.schedules.fire` → POST /api/engine/schedule-tick).
  schedules: defineTable({
    orgId: v.string(),
    workflowId: v.id("workflows"),
    cron: v.string(),
    timezone: v.optional(v.string()),
    enabled: v.boolean(),
    // The `_scheduled_functions` row that will fire this schedule next. "Pause" cancels it, and a
    // re-arm cancels it before scheduling its replacement, so at most one job per schedule is
    // pending at a time.
    jobId: v.optional(v.id("_scheduled_functions")),
    nextAt: v.optional(v.number()),
    // The instant `jobId` was armed for. Identical to `nextAt` while a job is pending; it travels
    // with the job as its argument, which is what makes a tick claimable exactly once.
    plannedAt: v.optional(v.number()),
    lastFiredAt: v.optional(v.number()),
    // Why the last tick could not reach the app, shown on the Schedule trigger's panel. Cleared by
    // the next tick that works.
    lastError: v.optional(v.string()),
    /** Failed deliveries of the current tick. Back to 0 the moment one succeeds. */
    attempts: v.optional(v.number()),
    // Legacy: the sleeping Workflow SDK scheduler run this table used to point at, before Convex
    // became the alarm clock. Nothing writes it any more; it stays optional so rows written by the
    // old design still validate.
    runId: v.optional(v.string()),
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
