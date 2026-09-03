import {
  getBuilderRun,
  listBuilderRuns,
  type BuilderRun,
  type BuilderRunDetail,
  type BuilderRunStep,
} from "../../../lib/builder-engine";
import { EngineUnavailableError } from "../../../lib/engine-env";
import { redact } from "../../../lib/redact";

import { readWorkflow, storedNodesOf } from "./edits";
import type { BuilderSession } from "./session";
import { viaEngine } from "./tool-result";

/**
 * Reading what a run actually did — the half of the Builder that turns "I can't read run logs from
 * here" into a loop it can close on its own.
 *
 * Three rules shape everything below.
 *
 * 1. **Secret-free by construction, then again by hand.** `steps.input` was redacted by `runNode`
 *    before Convex ever saw it (CLAUDE.md rule 1), and a connection's plaintext never travels on a
 *    step at all. It still goes through `redact()` on the way out, because this data is read by a
 *    model and quoted into a chat panel, and a node added next month that puts a header somewhere
 *    unexpected should not be the thing that finds out.
 * 2. **Bounded.** A Loop over two hundred items writes two hundred step rows, and an HTTP node's
 *    output can be a megabyte of HTML. Each value is trimmed to about 2 KB, and the step list is
 *    capped in Convex.
 * 3. **Addressed by node key, not node id.** The model writes templates against keys
 *    (`{{ http_request_1.body }}`), so a step row it reads has to be labelled the same way.
 */

/** Roughly 2 KB per recorded value: enough to see the shape, small enough to read twenty of them. */
export const VALUE_LIMIT = 2000;

/** Statuses a run will not move on from without something outside the Builder happening. */
const SETTLED: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

/** True when polling this run again would learn nothing: it finished, or it is parked on a hook. */
export function isSettled(status: string): boolean {
  return SETTLED.has(status) || status === "waiting";
}

/**
 * One recorded value, small enough to read.
 *
 * Under the limit it comes back as itself, so the model sees real JSON and can write a template
 * against a path it can see. Over it, the JSON is cut and marked — a truncated object would be
 * invalid JSON and a model will happily "fix" it by inventing the rest.
 */
export function trimValue(value: unknown, limit = VALUE_LIMIT): unknown {
  if (value === undefined) return undefined;

  const safe = redact(value);
  let json: string;
  try {
    json = JSON.stringify(safe) ?? "undefined";
  } catch {
    // A cyclic or otherwise unserializable value: Convex could not have stored one, but the row is
    // `v.any()` and this must never be the thing that throws.
    return "[unreadable]";
  }

  if (json.length <= limit) return safe;
  return `${json.slice(0, limit)}…truncated (${json.length} characters in full)`;
}

/** Milliseconds a step or a run took, or `undefined` while it is still going. */
function durationOf(startedAt: number, finishedAt?: number): number | undefined {
  return finishedAt === undefined ? undefined : Math.max(0, finishedAt - startedAt);
}

export type RunSummary = {
  runId: string;
  status: string;
  trigger: string;
  startedAt: string;
  durationMs?: number;
  error?: string;
  workflowVersion: number;
};

/** One line per run, as `list_runs` answers. */
export function summariseRun(run: BuilderRun): RunSummary {
  return {
    runId: run.executionId,
    status: run.status,
    trigger: run.triggerType,
    startedAt: new Date(run.startedAt).toISOString(),
    durationMs: durationOf(run.startedAt, run.finishedAt),
    error: run.error,
    workflowVersion: run.workflowVersion,
  };
}

export type StepSummary = {
  /** The node's template key, which is how the model refers to it everywhere else. */
  node: string;
  label: string;
  nodeType: string;
  status: string;
  attempt: number;
  /** 1-based, and only on a node inside a Loop body. */
  loopPass?: number;
  durationMs?: number;
  error?: string;
  /** Templates that resolved to nothing. The commonest cause of a step that "worked" but wrote nothing. */
  warnings?: string[];
  input?: unknown;
  output?: unknown;
  /** Set on a row the node spawned rather than one the graph contains — an Agent node's tool call. */
  childOf?: string;
};

/** Node id → what the graph calls it, so a step row reads as `airtable_create_record_1`. */
export type NodeIndex = Record<string, { key: string; label: string; nodeType?: string }>;

/**
 * The step rows in the order they started, each named the way the graph names it.
 *
 * A node the run never reached has a `skipped` row with an empty `nodeType` (`convex/steps.ts`),
 * which is worth keeping: "the branch was not taken" is the answer to half the questions someone
 * asks about a run that did nothing.
 */
export function summariseSteps(
  steps: readonly BuilderRunStep[],
  nodes: NodeIndex,
  limit = VALUE_LIMIT,
): StepSummary[] {
  const byId = new Map(steps.map((step) => [step.stepId, step]));

  return [...steps]
    .sort((a, b) => a.startedAt - b.startedAt || (a.iteration ?? 0) - (b.iteration ?? 0))
    .map((step) => {
      const named = nodes[step.nodeId];
      const parent = step.parentStepId ? byId.get(step.parentStepId) : undefined;
      const parentName = parent ? (nodes[parent.nodeId]?.key ?? parent.nodeId) : undefined;

      return {
        node: named?.key || step.nodeId,
        label: named?.label ?? step.nodeType,
        // A `skipped` row is written with no `nodeType` — the engine only had the id of a node the
        // run never reached (`convex/steps.ts`) — so the graph supplies it.
        nodeType: step.nodeType || named?.nodeType || "unknown",
        status: step.status,
        attempt: step.attempt,
        ...(step.iteration === undefined ? {} : { loopPass: step.iteration + 1 }),
        durationMs: durationOf(step.startedAt, step.finishedAt),
        ...(step.error ? { error: step.error } : {}),
        ...(step.warnings && step.warnings.length > 0 ? { warnings: step.warnings } : {}),
        input: trimValue(step.input, limit),
        output: trimValue(step.output, limit),
        ...(parentName ? { childOf: parentName } : {}),
      };
    });
}

/** What every node in the graph is called, for `summariseSteps`. */
export async function nodeIndex(session: BuilderSession): Promise<NodeIndex> {
  const workflow = await readWorkflow(session);
  const index: NodeIndex = {};
  for (const node of storedNodesOf(workflow)) {
    index[node.id] = { key: node.key || node.id, label: node.label, nodeType: node.nodeType };
  }
  return index;
}

export type RunReport = RunSummary & {
  steps: StepSummary[];
  /** True while the run is still going — the tool stopped waiting, the run did not. */
  stillRunning: boolean;
};

/** One run's rows, straight from Convex. */
function fetchRun(session: BuilderSession, executionId: string): Promise<BuilderRunDetail> {
  return viaEngine(() =>
    getBuilderRun({ executionId, workflowId: session.workflowId, orgId: session.orgId }),
  );
}

/** The rows joined to the graph's names. Pure, so the wait can build it once at the end. */
function report(detail: NonNullable<BuilderRunDetail>, nodes: NodeIndex): RunReport {
  return {
    ...summariseRun(detail.execution),
    stillRunning: !SETTLED.has(detail.execution.status),
    steps: summariseSteps(detail.steps, nodes),
  };
}

/** One run, joined to the graph's names. Returns null when that id is not a run of this workflow. */
export async function runReport(
  session: BuilderSession,
  executionId: string,
): Promise<RunReport | null> {
  const [detail, nodes] = await Promise.all([fetchRun(session, executionId), nodeIndex(session)]);
  return detail ? report(detail, nodes) : null;
}

/** The workflow's recent runs, newest first. */
export async function listRuns(session: BuilderSession, limit?: number): Promise<RunSummary[]> {
  const runs = await viaEngine(() => listBuilderRuns(session.workflowId, session.orgId, limit));
  return runs.map(summariseRun);
}

/* -------------------------------------------------------------------------------------------------
 * Starting a run.
 *
 * The Builder cannot call start() from workflow/api itself, and this is not a style choice.
 *
 * A workflow function only exists as one once the Workflow SDK's compiler has transformed it, and
 * that transform runs in the *Next* build: withWorkflow() wires the loaders and generates the
 * .well-known/workflow routes, while withEve() writes each agent as a separate Vercel Build Output
 * service (docs/research/eve-spike.md, Phase 12 addendum item 5 — the SDK still reports two
 * workflows, run-graph and scheduler, and a workflow-tool inside an agent belongs to that agent's
 * service). Importing lib/engine-client.ts here would also drag runGraph, every step file and the
 * whole node registry's I/O into the Builder's bundle, which is the exact thing lib/builder-engine.ts
 * exists to avoid.
 *
 * So the tool asks the Next app to press Run for it, over the same shared secret every other
 * session-less caller uses (CLAUDE.md rule 5). The route is app/api/engine/run/route.ts, and it
 * calls the same startRun() the Run button's server action calls, with the same Clerk plan
 * snapshot — one code path, one set of quota checks, one trigger sample fallback.
 * ---------------------------------------------------------------------------------------------- */

/** Where the Next app answers. The eve service carries it as APP_ORIGIN, like every other service. */
function appOrigin(): string {
  const origin = (process.env.APP_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!origin) {
    throw new EngineUnavailableError("builder/runs: APP_ORIGIN is not set on this service");
  }
  return origin;
}

/** The shared secret the run route compares. Missing it is a deployment problem, not a model one. */
function engineSecret(): string {
  const secret = (process.env.ENGINE_SECRET ?? "").trim();
  if (!secret) {
    throw new EngineUnavailableError("builder/runs: ENGINE_SECRET is not set on this service");
  }
  return secret;
}

/**
 * Starts a manual run of this workflow and returns its execution id.
 *
 * Refusals the user has to act on — no trigger, the plan's monthly run limit — come back as plain
 * Errors with the route's own sentence, so the model reads them and stops. Anything else is
 * infrastructure and becomes an EngineUnavailableError, which the tool turns into a terminal result.
 */
export async function startManualRun(
  session: BuilderSession,
  payload: Record<string, unknown> | undefined,
): Promise<{ runId: string }> {
  let response: Response;
  try {
    response = await fetch(`${appOrigin()}/api/engine/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${engineSecret()}`,
      },
      body: JSON.stringify({
        workflowId: session.workflowId,
        orgId: session.orgId,
        userId: session.userId,
        ...(payload ? { payload } : {}),
      }),
    });
  } catch (cause) {
    throw new EngineUnavailableError("builder/runs: the app did not answer /api/engine/run", {
      cause,
    });
  }

  const body: unknown = await response.json().catch(() => null);
  const read = (name: string): string => {
    const value = (body as Record<string, unknown> | null)?.[name];
    return typeof value === "string" ? value : "";
  };

  if (response.ok) {
    const runId = read("executionId");
    if (!runId) {
      throw new EngineUnavailableError("builder/runs: /api/engine/run answered without a run id");
    }
    return { runId };
  }

  // 401 and 5xx are ours to fix; 4xx is the workflow's or the plan's, and the model can act on it.
  if (response.status === 401 || response.status >= 500) {
    throw new EngineUnavailableError(
      `builder/runs: /api/engine/run answered ${response.status} — ${read("error") || "no detail"}`,
    );
  }
  throw new Error(read("error") || `The run could not be started (${response.status}).`);
}

/** How often the wait asks Convex whether the run has moved on. */
const POLL_MS = 1500;

/** The longest a tool call is allowed to sit on a run before handing back what it has. */
export const MAX_WAIT_SECONDS = 60;

/**
 * Waits for a run to settle, then reports it.
 *
 * "Settled" includes `waiting`: a workflow parked on a Wait or an Approval is not going to move
 * while a tool call watches it, and the steps recorded up to that point are the useful part.
 */
export async function waitForRun(
  session: BuilderSession,
  executionId: string,
  seconds: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<RunReport | null> {
  const deadline = Date.now() + Math.min(Math.max(seconds, 0), MAX_WAIT_SECONDS) * 1000;

  // Read once: a run cannot change the graph it is interpreting, and a poll every 1.5 s is no place
  // for a second Convex round trip.
  const nodes = await nodeIndex(session);

  let detail = await fetchRun(session, executionId);
  while (detail && !isSettled(detail.execution.status) && Date.now() < deadline) {
    await sleep(POLL_MS);
    detail = await fetchRun(session, executionId);
  }
  return detail ? report(detail, nodes) : null;
}

export type { BuilderRun, BuilderRunDetail, BuilderRunStep };
