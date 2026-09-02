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
 * The AES-256-GCM envelope `lib/vault.ts` produces (`{ v, keyId, iv, tag, ct }`, all base64), as
 * stored on `connections.secret`. Convex never sees the plaintext: sealing happens in Node before
 * the row is written and opening happens inside a `"use step"` (CLAUDE.md rules 1 and 2).
 */
export const sealedValidator = schema.tables.connections.validator.fields.secret;
export const connectionKindValidator = schema.tables.connections.validator.fields.kind;
export const connectionStatusValidator = schema.tables.connections.validator.fields.status;

export type Sealed = typeof sealedValidator.type;
export type ConnectionKind = typeof connectionKindValidator.type;
export type ConnectionStatus = typeof connectionStatusValidator.type;

/**
 * One connection row as `/api/connections` creates it — everything except the secret.
 *
 * The secret cannot be part of this: it is sealed with AAD `${orgId}:${connectionId}`, so it can
 * only be written once the row exists and its id is known. `create` therefore inserts a placeholder
 * and `patchSecret` fills it in.
 */
export const connectionCreateArgs = {
  orgId: v.string(),
  createdBy: v.string(),
  provider: v.string(),
  kind: connectionKindValidator,
  label: v.string(),
  hint: v.string(),
  /** Connector-supplied, non-secret: `{ models, fetchedAt, … }`. Projected through `safeMeta`. */
  meta: v.any(),
  requiresFeature: v.optional(v.string()),
} as const;

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
  /** `resolveTemplates` could not find these paths; the step ran anyway. */
  warnings: v.optional(v.array(v.string())),
  handle: v.optional(v.string()),
  hookToken: v.optional(v.string()),
  /** The Loop pass this row belongs to; absent for a node that runs once. Part of its identity. */
  iteration: v.optional(v.number()),
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
