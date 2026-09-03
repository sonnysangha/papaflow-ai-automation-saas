// Server only. Like `lib/connections-engine.ts`, this module talks to Convex with `ENGINE_SECRET`
// and must never be imported from a Client Component or any browser bundle.
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { engineEnv } from "@/lib/engine-env";

/**
 * The Builder agent's Convex conversation.
 *
 * It exists rather than reusing `lib/engine-client.ts` for the same reason
 * `lib/connections-engine.ts` does: that module imports `workflows/run-graph.ts` to let
 * `withWorkflow()` discover the workflow, and eve compiles an agent by following its imports —
 * `"use workflow"` bodies have no business in the agent bundle. The dependency list here is exactly
 * the Convex HTTP client and the generated API.
 *
 * Two callers share it: the Builder's tools (inside the eve service) and
 * `app/api/builder/session/route.ts` (a Next route handler that has already checked the Clerk
 * session itself). Both pass the `orgId` they proved, and every Convex function re-checks it
 * against the row it is about to touch.
 */

/** The stored graph as the Builder reads it back. `nodes`/`edges` are `v.any()` in Convex. */
export type BuilderGraph = {
  nodes: unknown[];
  edges: unknown[];
  viewport?: unknown;
  triggerId?: string;
};

export type BuilderWorkflow = {
  name: string;
  status: "draft" | "active" | "paused";
  version: number;
  graph: BuilderGraph;
};

/**
 * A fresh client plus the shared secret, per call — a client captured at import time would freeze
 * whatever the URL happened to be when the bundle was built.
 *
 * The Builder runs as its own Vercel service, which is exactly why the URL cannot come from
 * `NEXT_PUBLIC_CONVEX_URL` alone: that one exists only inside the Next build (`lib/engine-env.ts`).
 * A missing variable throws `EngineUnavailableError`, which the tools turn into a terminal result
 * rather than something the model retries.
 */
function engineConvex(): { client: ConvexHttpClient; secret: string } {
  const { url, secret } = engineEnv("builder-engine");
  return { client: new ConvexHttpClient(url), secret };
}

/**
 * The sentence a refusal should show the model.
 *
 * Convex mutations here throw `ConvexError({ code, message })`; anything else is unexpected and its
 * message is passed through so a broken deployment does not look like a graph problem.
 */
export function builderErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (typeof data === "object" && data !== null) {
      const { code, message } = data as { code?: unknown; message?: unknown };
      if (typeof message === "string") return message;
      if (code === "not_found") return "That workflow is not this organisation's.";
      if (typeof code === "string") return code;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export type EditIdentity = {
  workflowId: string;
  orgId: string;
  userId: string;
};

/** The workflow the Builder is editing, or null when it does not belong to this organisation. */
export async function getBuilderWorkflow(
  workflowId: string,
  orgId: string,
): Promise<BuilderWorkflow | null> {
  const { client, secret } = engineConvex();
  return await client.query(api.builder.getGraph, {
    secret,
    workflowId: workflowId as Id<"workflows">,
    orgId,
  });
}

export async function addBuilderNode(
  identity: EditIdentity,
  node: { nodeType: string; label: string; inputs: Record<string, unknown>; isTrigger: boolean },
): Promise<{ nodeId: string; key: string; version: number }> {
  const { client, secret } = engineConvex();
  return await client.mutation(api.builder.addNode, {
    secret,
    workflowId: identity.workflowId as Id<"workflows">,
    orgId: identity.orgId,
    userId: identity.userId,
    ...node,
  });
}

export async function connectBuilderNodes(
  identity: EditIdentity,
  edge: { from: string; to: string; sourceHandle?: string },
): Promise<{ edgeId: string; version: number }> {
  const { client, secret } = engineConvex();
  return await client.mutation(api.builder.connectNodes, {
    secret,
    workflowId: identity.workflowId as Id<"workflows">,
    orgId: identity.orgId,
    userId: identity.userId,
    ...edge,
  });
}

export async function configureBuilderNode(
  identity: EditIdentity,
  change: { node: string; inputs: Record<string, unknown>; label?: string },
): Promise<{ nodeId: string; key: string; inputs: Record<string, unknown>; version: number }> {
  const { client, secret } = engineConvex();
  return await client.mutation(api.builder.configureNode, {
    secret,
    workflowId: identity.workflowId as Id<"workflows">,
    orgId: identity.orgId,
    userId: identity.userId,
    ...change,
  });
}

export async function removeBuilderNode(
  identity: EditIdentity,
  node: string,
): Promise<{ nodeId: string; key: string; removedEdges: number; version: number }> {
  const { client, secret } = engineConvex();
  return await client.mutation(api.builder.removeNode, {
    secret,
    workflowId: identity.workflowId as Id<"workflows">,
    orgId: identity.orgId,
    userId: identity.userId,
    node,
  });
}

export async function updateBuilderNode(
  identity: EditIdentity,
  change: { node: string; label?: string; position?: { x: number; y: number } },
): Promise<{ nodeId: string; key: string; version: number }> {
  const { client, secret } = engineConvex();
  return await client.mutation(api.builder.updateNode, {
    secret,
    workflowId: identity.workflowId as Id<"workflows">,
    orgId: identity.orgId,
    userId: identity.userId,
    ...change,
  });
}

export async function renameBuilderWorkflow(
  identity: EditIdentity,
  name: string,
): Promise<{ name: string; version: number }> {
  const { client, secret } = engineConvex();
  return await client.mutation(api.builder.rename, {
    secret,
    workflowId: identity.workflowId as Id<"workflows">,
    orgId: identity.orgId,
    userId: identity.userId,
    name,
  });
}

/* -------------------------------------------------------------------------------------------------
 * Runs.
 *
 * What the workflow actually did, for the tools that debug rather than build. Both are scoped to the
 * one workflow the chat is bound to, and Convex re-checks the organisation on every call.
 * ---------------------------------------------------------------------------------------------- */

/** One execution, as `list_runs` and `get_run` describe it. */
export type BuilderRun = FunctionReturnType<typeof api.builder.listRuns>[number];

/** One run's step rows, or null when that id is not a run of this workflow. */
export type BuilderRunDetail = FunctionReturnType<typeof api.builder.getRun>;

/** One step row of one run. `input` was redacted by the engine before it was stored. */
export type BuilderRunStep = NonNullable<BuilderRunDetail>["steps"][number];

export async function listBuilderRuns(
  workflowId: string,
  orgId: string,
  limit?: number,
): Promise<BuilderRun[]> {
  const { client, secret } = engineConvex();
  return await client.query(api.builder.listRuns, {
    secret,
    workflowId: workflowId as Id<"workflows">,
    orgId,
    ...(limit === undefined ? {} : { limit }),
  });
}

export async function getBuilderRun(args: {
  executionId: string;
  workflowId: string;
  orgId: string;
}): Promise<BuilderRunDetail> {
  const { client, secret } = engineConvex();
  return await client.query(api.builder.getRun, {
    secret,
    executionId: args.executionId as Id<"executions">,
    workflowId: args.workflowId as Id<"workflows">,
    orgId: args.orgId,
  });
}

/*
 * There is deliberately no `activateBuilderWorkflow` here any more.
 *
 * Publishing is not a status write: a Schedule trigger's "on" is the workflow's `status` *and* a
 * durable scheduler run sleeping until the next occurrence, and Convex cannot start one. While
 * `finish` published through `api.builder.activate`, a schedule-triggered workflow the Builder
 * built was live in the canvas and never fired. It now calls `POST /api/engine/publish`, which runs
 * the same `applyPublish()` the Publish button runs (`agents/builder/lib/engine-route.ts`).
 */

/** Opens (or reuses) this user's Builder chat for one workflow. */
export async function startBuilderSession(args: {
  workflowId: string;
  orgId: string;
  userId: string;
}): Promise<{ builderSessionId: string; eveSessionId: string }> {
  const { client, secret } = engineConvex();
  return await client.mutation(api.builder.startSession, {
    secret,
    workflowId: args.workflowId as Id<"workflows">,
    orgId: args.orgId,
    userId: args.userId,
  });
}

/** Records the eve session id the panel learned once its first turn was accepted. */
export async function attachEveSession(args: {
  builderSessionId: string;
  orgId: string;
  userId: string;
  eveSessionId: string;
}): Promise<void> {
  const { client, secret } = engineConvex();
  await client.mutation(api.builder.attachEveSession, {
    secret,
    builderSessionId: args.builderSessionId as Id<"builderSessions">,
    orgId: args.orgId,
    userId: args.userId,
    eveSessionId: args.eveSessionId,
  });
}
