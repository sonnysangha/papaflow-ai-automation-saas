import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { start } from "workflow/api";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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

/** One `markStep` call, with `executionId` as the plain string the step boundary carries. */
export type MarkStepInput = MarkStepArgs & { executionId: string };

/** One `createExecution` call. `workflowVersion` and `planSlug` pin the run to what it started on. */
export type CreateExecutionInput = CreateExecutionArgs;

/**
 * A fresh HTTP client plus the shared secret. Built per call rather than at module load: the
 * Workflow SDK bundles step modules for the Vercel runtime, and a client captured at import time
 * would freeze whatever `NEXT_PUBLIC_CONVEX_URL` happened to be at build time.
 */
export function engineClient(): { client: ConvexHttpClient; secret: string } {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.ENGINE_SECRET;
  if (!url || !secret) {
    throw new Error("engine client: NEXT_PUBLIC_CONVEX_URL and ENGINE_SECRET are required");
  }
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

export async function getStep(executionId: string, nodeId: string): Promise<StoredStep> {
  const { client, secret } = engineClient();
  return await client.query(api.engine.getStep, {
    secret,
    executionId: executionRef(executionId),
    nodeId,
  });
}

export async function markStep({ executionId, ...args }: MarkStepInput): Promise<void> {
  const { client, secret } = engineClient();
  await client.mutation(api.engine.markStep, {
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
export type ConnectionSealed = {
  orgId: string;
  provider: string;
  kind: string;
  secret: Sealed;
  expiresAt?: number;
  status: "active" | "needs_reconnect" | "revoked";
};

/**
 * TODO(phase4-task3): `convex/engine.ts` does not export `getConnectionSealed` yet, so the generated
 * `api.engine` has no such member and the reference is described here instead. Delete this type and
 * the cast below the moment the Convex query lands; the wrapper's signature does not change.
 */
type EngineApi = typeof api.engine & {
  getConnectionSealed: FunctionReference<
    "query",
    "public",
    { secret: string; connectionId: string },
    ConnectionSealed
  >;
};

/** The sealed credential row for a connection. Secret-checked on the Convex side, like the rest. */
export async function getConnectionSealed(connectionId: string): Promise<ConnectionSealed> {
  const { client, secret } = engineClient();
  return await client.query((api.engine as EngineApi).getConnectionSealed, {
    secret,
    connectionId,
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
  const executionId = await createExecution({
    orgId: input.orgId,
    workflowId: input.workflowId,
    workflowVersion: workflow.version,
    planSlug: input.planSlug,
    trigger: input.trigger,
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
    output: input.trigger.payload,
  });

  const run = await start(
    runGraph,
    [{ executionId, orgId: input.orgId, graph, trigger: input.trigger }],
    // Plaintext run metadata, filterable in the run inspector and the Vercel dashboard. Ids only.
    { attributes: { executionId, orgId: input.orgId } },
  );

  await setRunId(executionId, run.runId);
  return { executionId, runId: run.runId };
}
