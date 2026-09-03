import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { FatalError } from "workflow";
import { start } from "workflow/api";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { engineEnv } from "@/lib/engine-env";
import type { Sealed } from "@/lib/vault";
import { toRunGraph } from "@/workflows/graph";
import { runGraph } from "@/workflows/run-graph";
import type { Trigger } from "@/workflows/types";

/**
 * The engine's half of the Convex conversation.
 *
 * Steps run on Vercel with no user session, so they authenticate with `ENGINE_SECRET` against the
 * public-but-guarded functions in `convex/engine.ts` (CLAUDE.md rule 5). Everything below is a thin
 * wrapper: no business logic, so a step file stays a step file and the argument shapes are the
 * generated ones — `FunctionArgs` keeps them in lockstep with the Convex validators.
 *
 * Import note: this module imports `runGraph`, which imports the step files, which import this
 * module. The cycle is intentional and harmless (every binding is a hoisted function used at call
 * time), and it is what makes the workflow discoverable: `withWorkflow()` finds workflows by
 * following the imports of Next entrypoints looking for `start()` from `workflow/api`, so the
 * `start(runGraph, …)` call has to sit on a path that a page or route actually imports.
 */

type MarkStepArgs = Omit<FunctionArgs<typeof api.engine.markStep>, "secret" | "executionId">;
type CreateExecutionArgs = Omit<FunctionArgs<typeof api.engine.createExecution>, "secret">;

/** `{ graph, version, name, webhookSecret }`, or null when the workflow is not this org's. */
export type WorkflowForRun = FunctionReturnType<typeof api.engine.getWorkflowForRun>;

/** A stored `steps` row — what `runNode` reads to decide whether it has already done the work. */
export type StoredStep = FunctionReturnType<typeof api.engine.getStep>;

/** The projection a resume route gets from a hook token: ids and status, never node data. */
export type StepByHookToken = FunctionReturnType<typeof api.engine.getStepByHookToken>;

/** The same, found by the row's own id — what an Approval button's `approve:<id>` resolves to. */
export type StepById = FunctionReturnType<typeof api.engine.getStepById>;

/** One `markStep` call, with `executionId` as the plain string the step boundary carries. */
export type MarkStepInput = MarkStepArgs & { executionId: string };

/** One `createExecution` call. `workflowVersion` and `planSlug` pin the run to what it started on. */
export type CreateExecutionInput = CreateExecutionArgs;

/**
 * A fresh HTTP client plus the shared secret. Built per call rather than at module load: the
 * Workflow SDK bundles step modules for the Vercel runtime, and a client captured at import time
 * would freeze whatever the URL happened to be at build time.
 *
 * `engineEnv` reads `CONVEX_URL` first and `NEXT_PUBLIC_CONVEX_URL` second, and refuses with an
 * `EngineUnavailableError` naming the variable that is missing (`lib/engine-env.ts` explains why
 * the two spellings exist).
 */
export function engineClient(): { client: ConvexHttpClient; secret: string } {
  const { url, secret } = engineEnv("engine client");
  return { client: new ConvexHttpClient(url), secret };
}

/** Ids cross a step boundary as plain strings; Convex wants its branded ids back. */
function executionRef(executionId: string): Id<"executions"> {
  return executionId as Id<"executions">;
}

export async function getWorkflowForRun(
  workflowId: Id<"workflows">,
  orgId: string,
): Promise<WorkflowForRun> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getWorkflowForRun, { secret, workflowId, orgId });
}

/**
 * Publishes a workflow, or takes it back off the air, on behalf of a signed-in user.
 *
 * Called from the `publishWorkflow` server action, which has an `orgId` from Clerk but no Convex
 * session — the same shape every other server-side write in this app takes. `draft` is not a
 * destination (`convex/workflows.ts`), so the two states here are the only two publishing moves
 * between.
 */
export async function setWorkflowStatus(args: {
  workflowId: string;
  orgId: string;
  status: "active" | "paused";
}): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.workflows.setStatusFromEngine, {
    secret,
    id: workflowRef(args.workflowId),
    orgId: args.orgId,
    status: args.status,
  });
}

export async function createExecution(args: CreateExecutionInput): Promise<Id<"executions">> {
  const { client, secret } = engineClient();
  return await client.mutation(api.engine.createExecution, { secret, ...args });
}

export async function setRunId(executionId: string, runId: string): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.setRunId, {
    secret,
    executionId: executionRef(executionId),
    runId,
  });
}

export async function getStep(
  executionId: string,
  nodeId: string,
  iteration?: number,
): Promise<StoredStep> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getStep, {
    secret,
    executionId: executionRef(executionId),
    nodeId,
    iteration,
  });
}

/**
 * The step a hook token addresses, or null. Ids and status only — a resume route has proved
 * nothing but possession of the token, and this is all it needs to decide whether to resume.
 */
export async function getStepByHookToken(hookToken: string): Promise<StepByHookToken> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getStepByHookToken, { secret, hookToken });
}

/**
 * The step a Convex id names. An Approval button carries `approve:<stepRowId>` rather than the hook
 * token (Telegram caps `callback_data` at 64 bytes), so this is the first half of turning a button
 * press back into a suspended run.
 */
export async function getStepById(stepId: string): Promise<StepById> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getStepById, {
    secret,
    stepId: stepId as Id<"steps">,
  });
}

/** Moves a run between `running` and `waiting`; a finished run is left exactly as it is. */
export async function setExecutionStatus(
  executionId: string,
  status: "running" | "waiting",
): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.setExecutionStatus, {
    secret,
    executionId: executionRef(executionId),
    status,
  });
}

/** Upserts the step row and hands back its id — the short address an Approval puts in its buttons. */
export async function markStep({ executionId, ...args }: MarkStepInput): Promise<Id<"steps">> {
  const { client, secret } = engineClient();
  return await client.mutation(api.engine.markStep, {
    secret,
    executionId: executionRef(executionId),
    ...args,
  });
}

export async function markSkipped(
  executionId: string,
  orgId: string,
  nodeIds: string[],
): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.markSkipped, {
    secret,
    executionId: executionRef(executionId),
    orgId,
    nodeIds,
  });
}

export async function finishExecution(
  executionId: string,
  status: FunctionArgs<typeof api.engine.finishExecution>["status"],
  error?: string,
): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.finishExecution, {
    secret,
    executionId: executionRef(executionId),
    status,
    error,
  });
}

/**
 * One connection as a step sees it: the sealed blob plus the non-secret fields needed to open it
 * (`orgId` is half the AAD) and to decide whether it is usable. `lib/vault.ts#openFresh` is the only
 * caller — nothing else should ever hold a sealed secret (CLAUDE.md rule 1).
 */
export type ConnectionSealed = NonNullable<
  FunctionReturnType<typeof api.engine.getConnectionSealed>
>;

/** One `createConnection` call: everything about a connection except the secret. */
export type CreateConnectionInput = Omit<
  FunctionArgs<typeof api.engine.createConnection>,
  "secret"
>;

/** `active` | `needs_reconnect` | `revoked`, taken from the table's own union. */
export type ConnectionStatus = FunctionArgs<typeof api.engine.setConnectionStatus>["status"];

/** Ids cross a route or step boundary as plain strings; Convex wants its branded ids back. */
function connectionRef(connectionId: string): Id<"connections"> {
  return connectionId as Id<"connections">;
}

/**
 * The sealed credential row for a connection. Secret-checked on the Convex side, like the rest.
 *
 * A deleted connection is a `FatalError`: a step cannot retry its way to a credential the user
 * removed, and neither can the retest route.
 */
export async function getConnectionSealed(connectionId: string): Promise<ConnectionSealed> {
  const { client, secret } = engineClient();
  const row = await client.query(api.engine.getConnectionSealed, {
    secret,
    connectionId: connectionRef(connectionId),
  });

  if (!row) throw new FatalError("Connection not found");
  return row;
}

/** Inserts the row so its id can become half of the AAD the secret is sealed with. */
export async function createConnection(args: CreateConnectionInput): Promise<Id<"connections">> {
  const { client, secret } = engineClient();
  return await client.mutation(api.engine.createConnection, { secret, ...args });
}

/** Stores the sealed credential (and activates the row). `sealed` is ciphertext. */
export async function patchConnectionSecret(args: {
  connectionId: string;
  orgId: string;
  sealed: Sealed;
}): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.patchConnectionSecret, {
    secret,
    connectionId: connectionRef(args.connectionId),
    orgId: args.orgId,
    sealed: args.sealed,
  });
}

/** Merges non-secret facts (the model list, a workspace name) into the row's `meta`. */
export async function updateConnectionMeta(args: {
  connectionId: string;
  orgId: string;
  meta: Record<string, unknown>;
  /** The indexed copy of one of them (Slack's `team_id`). Omitted leaves the column untouched. */
  externalId?: string;
}): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.updateConnectionMeta, {
    secret,
    connectionId: connectionRef(args.connectionId),
    orgId: args.orgId,
    meta: args.meta,
    externalId: args.externalId,
  });
}

/** One connection found by the provider's own id for it: an id to open, its org, and a label. */
export type ConnectionMatch = FunctionReturnType<
  typeof api.engine.listConnectionsByExternalId
>[number];

/**
 * The connections a provider-side account maps to — `POST /api/events/slack` asking "which rows
 * could this workspace's delivery belong to?".
 *
 * Several rows is normal (two organisations, one Slack workspace), and none is the common case for
 * a stranger's POST. Nothing here is proof of anything: the caller verifies the delivery against
 * each candidate's own signing secret before it acts on one.
 */
export async function listConnectionsByExternalId(args: {
  provider: string;
  externalId: string;
}): Promise<ConnectionMatch[]> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.listConnectionsByExternalId, { secret, ...args });
}

/**
 * The same lookup against `meta`, for connections created before `externalId` was a column — an
 * indexed scan of one provider's rows, so it is the fallback and never the first question.
 */
export async function listConnectionIdsByMeta(args: {
  provider: string;
  key: string;
  value: string;
}): Promise<string[]> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.listConnectionIdsByMeta, { secret, ...args });
}

/** Records the verdict of a credential test, or a provider's 401. */
export async function setConnectionStatus(args: {
  connectionId: string;
  orgId: string;
  status: ConnectionStatus;
}): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.setConnectionStatus, {
    secret,
    connectionId: connectionRef(args.connectionId),
    orgId: args.orgId,
    status: args.status,
  });
}

/** Deletes a connection. Convex re-checks `orgId` against the row before it goes. */
export async function removeConnection(args: {
  connectionId: string;
  orgId: string;
}): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.removeConnection, {
    secret,
    connectionId: connectionRef(args.connectionId),
    orgId: args.orgId,
  });
}

/**
 * Where every trigger ends up: manual runs today, webhooks, forms and schedules later. It reads the
 * workflow, opens the execution row (which counts the run against the org's plan and can refuse it
 * with `run_limit`), records the trigger node as already-succeeded, then enqueues the durable run.
 *
 * `planSlug` is the caller's business: a server action reads it from the Clerk session claims, the
 * engine reads it from the Clerk Backend API. It is snapshotted on the execution.
 *
 * The order matters. `createExecution` first, so a refused run never reaches the Workflow SDK; the
 * trigger's step row next, so the canvas has something green the moment the run appears; `start()`
 * last, and only then `setRunId`, which promotes the execution from `queued` to `running` — a row
 * with a `runId` is one the SDK has definitely accepted.
 */
export async function startRun(input: {
  orgId: string;
  workflowId: Id<"workflows">;
  trigger: Trigger;
  startedBy?: string;
  planSlug: string;
}): Promise<{ executionId: string; runId: string }> {
  const workflow = await getWorkflowForRun(input.workflowId, input.orgId);
  if (!workflow) throw new Error("workflow not found");

  const graph = toRunGraph(workflow.graph);
  // A Manual run pressed with an empty payload falls back to the trigger node's own sample, so a
  // template that reads `{{ start.items }}` works before anyone touches the run bar.
  const trigger = withTriggerSample(input.trigger, graph);
  const executionId = await createExecution({
    orgId: input.orgId,
    workflowId: input.workflowId,
    workflowVersion: workflow.version,
    planSlug: input.planSlug,
    trigger,
    startedBy: input.startedBy,
  });

  // The trigger node is not a step — its "output" is the payload that started the run — so nothing
  // else would ever write its row.
  await markStep({
    executionId,
    orgId: input.orgId,
    nodeId: graph.triggerId,
    nodeType: graph.nodes[graph.triggerId].data.nodeType,
    status: "success",
    attempt: 1,
    output: trigger.payload,
  });

  const run = await start(
    runGraph,
    [{ executionId, orgId: input.orgId, planSlug: input.planSlug, graph, trigger }],
    // Plaintext run metadata, filterable in the run inspector and the Vercel dashboard. Ids only.
    { attributes: { executionId, orgId: input.orgId } },
  );

  await setRunId(executionId, run.runId);
  return { executionId, runId: run.runId };
}

/* -------------------------------------------------------------------------------------------------
 * Triggers.
 *
 * The inbound routes (`/api/hooks/…`, `/api/events/…`, `/api/forms/…`) and the public form page are
 * session-less too, so they talk to Convex through the same guarded surface. Ids reach them as
 * plain strings out of the URL: `workflowRef` hands them back to Convex branded, and an id that is
 * not even shaped like one is refused by the validator — which the routes turn into a 404.
 * ---------------------------------------------------------------------------------------------- */

/** `{ orgId, webhookSecret, hasTrigger }`, or null when no workflow has that id. */
export type WorkflowPublic = FunctionReturnType<typeof api.engine.getWorkflowPublic>;

/** One workflow a trigger should start: enough to call `startRun`, nothing more. */
export type WorkflowForTrigger = FunctionReturnType<
  typeof api.engine.listWorkflowsByTrigger
>[number];

/** `{ name, form }` for the public form page, or null when the workflow has no form trigger. */
export type PublicForm = FunctionReturnType<typeof api.engine.getPublicForm>;

function workflowRef(workflowId: string): Id<"workflows"> {
  return workflowId as Id<"workflows">;
}

/**
 * What a webhook route may know before it has proved anything: the owning org, the secret to
 * compare the URL segment against (in the route, with `lib/timing.ts#safeEqual` — Convex has no
 * constant-time compare) and which trigger nodes the stored graph actually has.
 */
export async function getWorkflowPublic(workflowId: string): Promise<WorkflowPublic> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getWorkflowPublic, {
    secret,
    workflowId: workflowRef(workflowId),
  });
}

/** The workflows whose graph has this trigger node — optionally only those on one connection. */
export async function listWorkflowsByTrigger(args: {
  orgId?: string;
  triggerType: string;
  connectionId?: string;
}): Promise<WorkflowForTrigger[]> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.listWorkflowsByTrigger, { secret, ...args });
}

/**
 * Claims an inbound delivery before it starts a run. `{ duplicate: true }` means this exact event
 * has been seen before (providers retry) and the route should answer 200 without running anything.
 */
export async function recordWebhookEvent(args: {
  source: string;
  eventId: string;
}): Promise<{ duplicate: boolean }> {
  const { client, secret } = engineClient();
  return await client.mutation(api.engine.recordWebhookEvent, { secret, ...args });
}

/** The form trigger's configuration for the public page. No org check: the page is public. */
export async function getPublicForm(workflowId: string): Promise<PublicForm> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getPublicForm, {
    secret,
    workflowId: workflowRef(workflowId),
  });
}

/* -------------------------------------------------------------------------------------------------
 * Schedules.
 *
 * Two session-less callers share this surface: `convex/schedules.ts#fire`, which re-reads the row
 * every time its Convex job wakes and POSTs `/api/engine/schedule-tick` (below), and
 * `app/api/schedules/route.ts`, which has a Clerk session but no Convex token — it has already
 * checked the org itself and passes `orgId` down for the internal mutations to re-check against the
 * row.
 * ---------------------------------------------------------------------------------------------- */

/** One `schedules` row: the cron, the Convex job armed for it, and the tick bookkeeping. Never secret. */
export type ScheduleRow = NonNullable<FunctionReturnType<typeof api.engine.getSchedule>>;

/** One `upsertSchedule` call — everything the row needs except the run id, which arrives after. */
export type UpsertScheduleInput = Omit<FunctionArgs<typeof api.engine.upsertSchedule>, "secret">;

/** Ids cross a step or route boundary as plain strings; Convex wants its branded ids back. */
function scheduleRef(scheduleId: string): Id<"schedules"> {
  return scheduleId as Id<"schedules">;
}

/**
 * The schedule a scheduler run is sleeping on. Read fresh on every tick rather than carried in the
 * run's arguments, because "is this still enabled?" is exactly the question a days-old argument
 * cannot answer.
 */
export async function getSchedule(scheduleId: string): Promise<ScheduleRow | null> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getSchedule, {
    secret,
    scheduleId: scheduleRef(scheduleId),
  });
}

/** A workflow's schedule, or null — including when the workflow is not this org's. */
export async function getScheduleForWorkflow(
  workflowId: string,
  orgId: string,
): Promise<ScheduleRow | null> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getScheduleForWorkflow, {
    secret,
    workflowId: workflowRef(workflowId),
    orgId,
  });
}

/** Writes the workflow's schedule and hands back its id — the scheduler run's only argument. */
export async function upsertSchedule(args: UpsertScheduleInput): Promise<Id<"schedules">> {
  const { client, secret } = engineClient();
  return await client.mutation(api.engine.upsertSchedule, { secret, ...args });
}

/**
 * Arms the schedule for `nextAt`: Convex cancels whatever job was pending and schedules a fresh
 * `fire` for that instant. `enableSchedule` calls this once it has written the row with
 * `upsertSchedule`, because the job's only real argument is the id that write just produced.
 */
export async function armSchedule(args: { scheduleId: string; orgId: string; nextAt: number }): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.armSchedule, {
    secret,
    scheduleId: scheduleRef(args.scheduleId),
    orgId: args.orgId,
    nextAt: args.nextAt,
  });
}

/** Stops the schedule: cancels its pending Convex job and turns the row off. */
export async function disarmSchedule(args: { scheduleId: string; orgId: string }): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.disarmSchedule, {
    secret,
    scheduleId: scheduleRef(args.scheduleId),
    orgId: args.orgId,
  });
}

/**
 * Manual runs started with an empty payload take the trigger node's configured `sample` instead,
 * so a template whose first node reads `{{ start.items }}` runs the moment it is added. Anything
 * the caller typed wins; an invalid or empty sample leaves the payload as it was.
 */
export function withTriggerSample(trigger: Trigger, graph: ReturnType<typeof toRunGraph>): Trigger {
  if (trigger.type !== "manual") return trigger;
  const payload: unknown = trigger.payload;
  const empty =
    payload === null ||
    payload === undefined ||
    (typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).length === 0);
  if (!empty) return trigger;
  const node = graph.nodes[graph.triggerId];
  if (node?.data.nodeType !== "manual.trigger") return trigger;
  const sample = (node.data.inputs as { sample?: unknown } | undefined)?.sample;
  if (typeof sample !== "string" || !sample.trim()) return trigger;
  try {
    const parsed: unknown = JSON.parse(sample);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
      return { ...trigger, payload: parsed };
    }
  } catch {
    // An unparsable sample is the user's to fix in the node; the run still starts.
  }
  return trigger;
}
