# Phase 2 — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one fresh Opus subagent per task, sequential unless the orchestrator says a batch is disjoint. Tests first where a task says so.

**Goal:** Durable runs on the Workflow SDK: `runGraph` (`"use workflow"`) walks the graph, `runNode` (`"use step"`) executes one node, step rows land in Convex through `ENGINE_SECRET`-guarded mutations, the Manual trigger starts runs from a server action, the canvas lights up live, and `npx workflow web` shows the trace.

**Architecture:** `workflows/run-graph.ts` is orchestration only (frontier walk, `Promise.all` fan-out, `sleep`, `createHook` placeholders for Phase 8). All I/O lives in `"use step"` functions under `workflows/steps/`. Steps talk to Convex with `ConvexHttpClient` + public mutations that check `args.secret === process.env.ENGINE_SECRET` and delegate to internal mutations. Triggers all end in `lib/engine-client.ts#startRun()`.

**Tech Stack additions:** `workflow 5.0.0-beta.47` (install with the exact version; plain `workflow` installs 4.x). Docs for the installed version: `node_modules/workflow/docs/**` (v5) — read them; the unversioned website pages are v4.

**Spec:** master plan (`Engine contract`, `Verified stack`, `Phase 2`), `docs/research/workflow-sdk.md` (SUMMARY + SNIPPETS: imports, `start()`, `sleep()`, `createHook`, errors/retries, step id format, Local World), `docs/PLAN.md` lines 261-331, CLAUDE.md rules 4, 5, 7.

## Global constraints

- `"use workflow"` bodies: no global `fetch`, timers, `Buffer`, Node modules, `require`; `process.env` is a frozen read-only snapshot; `Promise.all`, loops, try/catch are fine. `createHook()` only in workflow bodies. `start()` from `workflow/api` is step-backed in v5 (allowed in workflow bodies and routes). `getRun`/`resumeHook` only in steps/routes.
- Step args and return values are recorded in the run log: pass ids, never secrets. `workflows/steps/run-node.ts` and its export name `runNode` are permanent once runs exist (step id `step//./workflows/steps/run-node//runNode`).
- Every step logs entry/exit with `console.log("runNode:start"|"runNode:end", { executionId, nodeId, nodeType, attempt })`.
- Convex functions that the engine calls are public but check `args.secret === process.env.ENGINE_SECRET` first, then `ctx.runMutation(internal…)`. Never `setAdminAuth`.
- Errors in steps: `ConnectorError` 429 → `RetryableError(msg, { retryAfter })`; 4xx / zod validation → `FatalError`; anything else rethrown (default 3 retries). Steps are safe to re-run: if the step row is already `success` for this execution+node, return its stored output.
- `pnpm typecheck && pnpm lint && pnpm test` must stay green; commit per task.

## File structure

```
next.config.mts                              renamed from next.config.ts; withWorkflow(nextConfig)
workflows/types.ts                           RunGraph, RunInput, NodeInput, NodeResult, HookPayload
workflows/graph.ts                           pure: toRunGraph(stored), nextNodes(graph, nodeId, handle), unvisited(graph, visited)
workflows/run-graph.ts                       "use workflow" runGraph
workflows/steps/run-node.ts                  "use step" runNode (permanent path/name)
workflows/steps/record.ts                    "use step" markSkipped, finishExecution, recordResume (thin wrappers over lib/engine-client)
lib/engine-client.ts                         ConvexHttpClient + ENGINE_SECRET helpers; startRun()
lib/redact.ts                                redact(obj): masks values whose key matches /secret|token|key|password|authorization/i
convex/engine.ts                             public secret-checked: getWorkflowForRun, createExecution, setRunId, getStep, markStep, markSkipped, finishExecution
convex/executions.ts                         internal create/setRunId/finish + api.executions.listByWorkflow, latestByWorkflow
convex/steps.ts                              internal mark/markSkipped/get + api.steps.byExecution
convex/usage.ts                              internal increment (runs per month) with PLAN_LIMITS check
app/(app)/w/[workflowId]/actions.ts          "use server" runWorkflow(workflowId, sampleJson)
components/canvas/RunBar.tsx                 Run button, sample JSON, last run status
components/canvas/Editor.tsx (mod)           subscribe to latest execution + steps → node status
components/canvas/Canvas.tsx (mod)           accept a statusByNode prop and merge into node data
app/(app)/w/[workflowId]/runs/page.tsx       executions list + steps drawer
tests/graph.test.ts  tests/redact.test.ts  tests/run-node.test.ts  convex/engine.test.ts
```

---

### Task 1: Install Workflow SDK, `next.config.mts`, types, pure graph helpers (+ tests)

- [ ] Step 1: `pnpm add workflow@5.0.0-beta.47` (verify `node_modules/workflow/package.json` version afterwards; if the beta tag moved, keep the exact pin). Read `node_modules/workflow/docs/getting-started/next.mdx` and `foundations/workflows-and-steps.mdx` and compare with `docs/research/workflow-sdk.md`; note any drift in the final report.
- [ ] Step 2: `git mv next.config.ts next.config.mts`; content:

```ts
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {};

export default withWorkflow(nextConfig);
```

Confirm `pnpm dev` boots (Turbopack) and `curl -s -o /dev/null -w '%{http_code}' localhost:3000/` is 200; stop it. `proxy.ts` already excludes `.well-known/workflow/`.
- [ ] Step 3: `workflows/types.ts`:

```ts
export type RunNode = { id: string; type: string; data: { nodeType: string; label: string; inputs: Record<string, unknown>; connectionId?: string } };
export type RunEdge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
export type RunGraph = { triggerId: string; nodes: Record<string, RunNode>; edges: RunEdge[] };
export type Trigger = { type: string; payload: unknown };
export type RunInput = { executionId: string; orgId: string; graph: RunGraph; trigger: Trigger };
export type NodeInput = { nodeId: string; nodeType: string; executionId: string; orgId: string; node: RunNode; outputs: Record<string, unknown>; item?: unknown };
export type Control = { kind: "sleep"; ms: number } | { kind: "hook" } | undefined;
export type NodeResult = { nodeId: string; output: unknown; handle: string | null; control: Control };
export type HookPayload = Record<string, unknown>;
```

- [ ] Step 4: tests first in `tests/graph.test.ts`: `toRunGraph` picks the trigger (first node whose `NODES[nodeType].category === "trigger"`, throws `"no trigger node"` otherwise); `nextNodes` follows edges whose `(sourceHandle ?? "out") === (handle ?? "out")`; fan-out returns both targets; a dangling edge (target missing) is ignored; `unvisited` lists the rest. Then implement `workflows/graph.ts` (pure, no I/O; imports `NODES` from `@/nodes/registry` only for category lookup).
- [ ] Step 5: `pnpm test --project unit`, `pnpm typecheck`. Commit `feat(engine): workflow sdk install, next.config.mts, run graph helpers`.

### Task 2: Convex engine surface (+ convex-test)

- [ ] Step 1: tests in `convex/engine.test.ts`: `markStep` with a wrong secret throws; with the right secret (set `process.env.ENGINE_SECRET = "test-secret"` in the test file before `convexTest`) it inserts a `steps` row and a second call for the same `executionId+nodeId` patches instead of duplicating; `createExecution` increments `usage.runs` for `YYYY-MM` and refuses at the plan limit (`free_org` = 100 → seed the usage row at 100 and expect `ConvexError` code `run_limit`); `finishExecution` sets `status`/`finishedAt`.
- [ ] Step 2: implement `convex/steps.ts` (internal `mark` = upsert by `by_execution_node`; `markSkipped` bulk insert `skipped` rows; `get`; public `byExecution` query gated by `requireOrg` + orgId check), `convex/executions.ts` (internal `create`, `setRunId`, `finish`; public `listByWorkflow` (newest first, limit 50) and `latestByWorkflow` gated by `requireOrg`), `convex/usage.ts` (internal `incrementRuns({ orgId, limit })` → throws `ConvexError({ code: "run_limit", limit })`), and `convex/engine.ts` with the public secret-checked wrappers:

```ts
const guard = (secret: string) => { if (!process.env.ENGINE_SECRET || secret !== process.env.ENGINE_SECRET) throw new ConvexError({ code: "unauthorized" }); };
export const markStep = mutation({ args: { secret: v.string(), executionId: v.id("executions"), orgId: v.string(), nodeId: v.string(), nodeType: v.string(), status: stepStatusValidator, attempt: v.number(), input: v.optional(v.any()), output: v.optional(v.any()), error: v.optional(v.string()), handle: v.optional(v.string()), hookToken: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, { secret, ...a }) => { guard(secret); await ctx.runMutation(internal.steps.mark, a); return null; } });
// getWorkflowForRun(query: secret, workflowId, orgId) → { graph, version, name } or null when orgId mismatches
// createExecution(mutation: secret, orgId, workflowId, workflowVersion, trigger, startedBy?) → executionId (calls internal.usage.incrementRuns with limitsForPlan(currentPlan).runsPerMonth)
// setRunId, getStep(query), markSkipped, finishExecution — same shape
```

`stepStatusValidator`/`executionStatusValidator` live in `convex/lib/validators.ts` and mirror `convex/schema.ts`.
- [ ] Step 3: `pnpm test --project convex`; push with `CONVEX_ALLOW_ANONYMOUS=false npx convex dev --once`; typecheck. Commit `feat(convex): engine mutations behind ENGINE_SECRET, executions, steps, usage`.

### Task 3: `runNode` step, `runGraph` workflow, engine client, `startRun` (+ tests)

- [ ] Step 1: `lib/engine-client.ts`:

```ts
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
export function engineClient() { const url = process.env.NEXT_PUBLIC_CONVEX_URL; const secret = process.env.ENGINE_SECRET; if (!url || !secret) throw new Error("engine client: NEXT_PUBLIC_CONVEX_URL and ENGINE_SECRET are required"); return { client: new ConvexHttpClient(url), secret }; }
export async function markStep(args: Omit<MarkStepArgs, "secret">) { const { client, secret } = engineClient(); await client.mutation(api.engine.markStep, { secret, ...args }); }
// getStep, markSkipped, finishExecution, setRunId, createExecution, getWorkflowForRun likewise
export async function startRun(input: { orgId: string; workflowId: Id<"workflows">; trigger: Trigger; startedBy?: string }) {
  const wf = await getWorkflowForRun(input.workflowId, input.orgId); if (!wf) throw new Error("workflow not found");
  const graph = toRunGraph(wf.graph);
  const executionId = await createExecution({ orgId: input.orgId, workflowId: input.workflowId, workflowVersion: wf.version, trigger: input.trigger, startedBy: input.startedBy });
  const run = await start(runGraph, [{ executionId, orgId: input.orgId, graph, trigger: input.trigger }], { attributes: { executionId, orgId: input.orgId } });
  await setRunId(executionId, run.runId);
  return { executionId, runId: run.runId };
}
```

`lib/redact.ts`: `redact(value)` deep-clones and replaces string values under keys matching `/secret|token|api[-_]?key|password|authorization|cookie/i` with `"••••"`; unit test it.
- [ ] Step 2: `workflows/steps/run-node.ts` — exactly the shape in the master plan's Engine contract, with: `getStepMetadata()` for `attempt`/`stepId`; the idempotency guard via `getStep`; `markStep(running)`; inputs = `def.inputs.parse(node.data.inputs)` (templates arrive in Phase 3; if `item !== undefined` merge it as `$item` later); `credential` undefined for now (Phase 4 adds `vault.openFresh`); `def.outputs.parse(await def.run(...))`; `handle`/`control`; `markStep(success|waiting, { input: redact(inputs), output, handle })`; error mapping per Global constraints; entry/exit logs. Unit test `tests/run-node.test.ts` with `vi.mock("@/lib/engine-client")` and `vi.mock("workflow", () => ({ getStepMetadata: () => ({ stepId: "s1", attempt: 1 }), FatalError: class extends Error {}, RetryableError: class extends Error {} }))`: success path calls `markStep` twice (running → success) with redacted input; a `ConnectorError(…, 429)` becomes `RetryableError`; a stored-success row short-circuits without calling `run`.
- [ ] Step 3: `workflows/steps/record.ts` — `"use step"` wrappers `recordSkipped(executionId, orgId, nodeIds)`, `recordFinish(executionId, status, error?)`, `recordResume(executionId, nodeId, output)` calling `lib/engine-client`.
- [ ] Step 4: `workflows/run-graph.ts`:

```ts
import { sleep, createHook } from "workflow";
import { runNode } from "@/workflows/steps/run-node";
import { recordFinish, recordResume, recordSkipped } from "@/workflows/steps/record";
import { nextNodes, unvisited } from "@/workflows/graph";
import type { RunInput, HookPayload } from "@/workflows/types";

export async function runGraph({ executionId, orgId, graph, trigger }: RunInput) {
  "use workflow";
  const outputs: Record<string, unknown> = { [graph.triggerId]: trigger.payload };
  const visited = new Set<string>([graph.triggerId]);
  let frontier = nextNodes(graph, graph.triggerId, null);
  try {
    while (frontier.length) {
      const results = await Promise.all(frontier.map((nodeId) => runNode({ nodeId, nodeType: graph.nodes[nodeId].data.nodeType, executionId, orgId, node: graph.nodes[nodeId], outputs })));
      frontier = [];
      for (const r of results) {
        let output = r.output;
        if (r.control?.kind === "sleep") await sleep(r.control.ms);
        if (r.control?.kind === "hook") {
          using hook = createHook<HookPayload>({ token: `${executionId}:${r.nodeId}` });
          output = await hook;
          await recordResume(executionId, r.nodeId, output);
        }
        outputs[r.nodeId] = output;
        for (const next of nextNodes(graph, r.nodeId, r.handle)) if (!visited.has(next)) { visited.add(next); frontier.push(next); }
      }
    }
    await recordSkipped(executionId, orgId, unvisited(graph, visited));
    await recordFinish(executionId, "completed");
    return { executionId, status: "completed" as const };
  } catch (err) {
    await recordFinish(executionId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
```

The trigger node itself gets a `success` step row written by `startRun` (through `markStep`) so the canvas shows it green.
- [ ] Step 5: server action `app/(app)/w/[workflowId]/actions.ts` (`"use server"`): `const { isAuthenticated, orgId, userId } = await auth(); if (!isAuthenticated || !orgId) throw new Error("unauthorized");` parse `sampleJson` (invalid → `{}`), `return startRun({ orgId, workflowId, trigger: { type: "manual", payload }, startedBy: userId })`.
- [ ] Step 6: `pnpm test`, `pnpm typecheck`, `pnpm lint`. Commit `feat(engine): runGraph workflow, runNode step, startRun`.

### Task 4: Live canvas status, RunBar, runs page

- [ ] Step 1: `Editor.tsx`: `const latest = useQuery(api.executions.latestByWorkflow, { workflowId }); const steps = useQuery(api.steps.byExecution, latest ? { executionId: latest._id } : "skip");` → `statusByNode: Record<string, StepStatus>`; pass to `<Canvas statusByNode>` which merges into `node.data.status` (via `useEffect` → `setNodes(map)`; do not trigger the debounced save for status-only changes — compare stored graphs with status stripped, `graph-io.ts` already strips runtime fields).
- [ ] Step 2: `RunBar.tsx` above the canvas: sample JSON `<Textarea>` (shown when the trigger is `manual.trigger`), `Run` `<Button>` → `runWorkflow` server action with `useTransition`, toast on error (`run_limit` → "Monthly run limit reached"), last run `<Badge>` (status + relative time), link to `/w/[id]/runs`.
- [ ] Step 3: `app/(app)/w/[workflowId]/runs/page.tsx` + `components/runs/RunsTable.tsx`: `listByWorkflow` rows (status badge, trigger type, started, duration, error), click → `<Sheet>` with the `steps.byExecution` table (node, status, attempt, duration, error, expandable input/output JSON).
- [ ] Step 4: verify in the browser (the Phase 2 Check in the master plan): Manual → HTTP Request (`https://jsonplaceholder.typicode.com/todos/1`) → Send email (to the user's own address if `RESEND_API_KEY` is set, otherwise expect the email node to fail with "No Resend key configured" and the run to be `failed` — both are valid outcomes for the check); nodes turn amber then green; `npx workflow web` lists the run with `runNode` steps; a bad URL turns that node red; `npx workflow health` passes. Commit `feat(canvas): live run status, run bar, runs page`.
