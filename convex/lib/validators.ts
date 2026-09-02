import { v } from "convex/values";

import schema from "../schema";

/**
 * Validators the engine surface shares with the tables it writes. They are read straight off the
 * schema rather than re-declared, so `convex/schema.ts` stays the single source of truth: adding a
 * status to a table's union immediately widens the engine's argument validators too.
 */
export const executionStatusValidator = schema.tables.executions.validator.fields.status;
export const stepStatusValidator = schema.tables.steps.validator.fields.status;
export const triggerValidator = schema.tables.executions.validator.fields.trigger;

export type ExecutionStatus = typeof executionStatusValidator.type;
export type StepStatus = typeof stepStatusValidator.type;
export type Trigger = typeof triggerValidator.type;

/**
 * One step upsert. `api.engine.markStep` takes exactly these plus `secret`, and hands them to
 * `internal.steps.mark`; declaring them once means the two can never drift apart.
 *
 * `input`/`output` are `v.any()` because they are node-defined JSON. `input` is redacted by the
 * step before it gets here (CLAUDE.md rule 1) — nothing on this table is secret-bearing.
 */
export const stepMarkArgs = {
  executionId: v.id("executions"),
  orgId: v.string(),
  nodeId: v.string(),
  nodeType: v.string(),
  status: stepStatusValidator,
  attempt: v.number(),
  input: v.optional(v.any()),
  output: v.optional(v.any()),
  error: v.optional(v.string()),
  handle: v.optional(v.string()),
  hookToken: v.optional(v.string()),
} as const;

/** One execution row, as the engine creates it at run start. */
export const executionCreateArgs = {
  orgId: v.string(),
  workflowId: v.id("workflows"),
  workflowVersion: v.number(),
  planSlug: v.string(),
  trigger: triggerValidator,
  startedBy: v.optional(v.string()),
} as const;
