# verify:workflow-sdk

## SUMMARY
Re-verified 2026-09-02 against npm, raw vercel/workflow source (packages/core, packages/workflow), the v5 docs at workflow-sdk.dev/v5/docs/*, vercel.com/docs/workflows{,/concepts,/pricing}, and the vendor skill.

Biggest corrections to the first pass:
1. DOCS VERSION TRAP: unversioned https://workflow-sdk.dev/docs/* pages are the v4 (latest=4.8.5) docs. The 5.x docs live at https://workflow-sdk.dev/v5/docs/* and https://workflow-sdk.dev/v5/worlds/*. The researcher cited v4 pages while pinning 5.x. Both getting-started pages still say `npm i workflow`, which installs 4.8.5; use `workflow@beta` (5.0.0-beta.47 today).
2. start() INSIDE A WORKFLOW IS ALLOWED IN v5 (since 5.0.0-beta.3). `start` from "workflow/api" is itself a 'use step' function; the v5 start page says "Call start() directly from a workflow function to spawn a child run. It is step-backed". Inside a workflow every Run property access (.status, .returnValue, .cancel()) is a separate step. `getRun`, `resumeHook`, `resumeWebhook`, `getHookByToken` throw in workflow context (stubbed in api-workflow.ts) and must be called in a step or runtime. Wrapping start() in a step (as PLAN/CLAUDE.md say) still works; keep it if you want a single step boundary.
3. `await run.returnValue` in a workflow polls the child every second and holds a worker slot; for long children, spawn without awaiting and have the child resume a parent hook. Self-chaining with `deploymentId: "latest"` is the documented "continue in a new run" pattern (no continue-as-new primitive).
4. Renaming/moving step or workflow files changes the compile-time id but, per the v5 code-transform page, "won't break old workflows from running" (runs are pinned to their deployment); it prevents run upgrades (`deploymentId: "latest"`) and changes names in observability. Local World has no deployments, so rename there mid-run at your own risk.
5. process.env IS readable in workflow code (frozen snapshot); CLAUDE.md rule 4 overstates. v5 also forbids WeakRef, FinalizationRegistry, async WASM; Buffer replaced by Uint8Array toBase64/fromBase64.

Everything else in the first pass held: sleep(string | ms | Date), no max; createHook only in workflow bodies, `using hook = createHook<T>({ token })`; resumeHook from runtime; FatalError/RetryableError(retryAfter string|ms|Date); 3 retries default, `fn.maxRetries = n`; withWorkflow from "workflow/next" with webpack+Turbopack loaders; proxy matcher must exclude `.well-known/workflow/`; limits 25k events / 10k steps / 240s replay / 50 MB; Hobby 50k events/month; WorkflowAgent from @ai-sdk/workflow@2.0.21 (stream() only, `instructions`, `stopWhen`, ModelCallStreamPart) replaces the deprecated DurableAgent that the vendor skill still teaches.

## VERSIONS
{
"workflow": "5.0.0-beta.47",
"@ai-sdk/workflow": "2.0.21",
"ai": "7.0.90",
"@workflow/vitest": "5.0.0-beta.47",
"zod (peer of @ai-sdk/workflow)": "^3.25.76 || ^4.1.8",
"@workflow/next (transitive via workflow, do not install)": "5.0.0-beta.47",
"@workflow/errors (transitive; import via workflow/errors)": "5.0.0-beta.19",
"@workflow/ai (deprecated, do not install)": "5.0.0-beta.15 beta / 4.2.1 latest",
"node (required by @ai-sdk/workflow; Vercel step runtime default nodejs22.x)": ">=22"
}

## COMMANDS
- npm i workflow@5.0.0-beta.47   # NOT `npm i workflow` (that installs 4.8.5); `workflow@beta` resolves to 5.0.0-beta.47 today
- npm i @ai-sdk/workflow@2.0.21 ai@7.0.90 zod   # only for WorkflowAgent; peer workflow ^5.0.0-beta.42
- npm i -D @workflow/vitest@5.0.0-beta.47   # optional in-process integration tests (waitForHook/waitForSleep)
- npm view workflow dist-tags --json   # re-check beta tag at install time
- next dev   # Local World starts automatically; run data in ./.workflow-data (WORKFLOW_LOCAL_DATA_DIR overrides)
- npx workflow web   # local run inspector UI (bins: workflow, wf)
- npx workflow web <run_id>
- npx workflow inspect runs   # add --json for machine output
- npx workflow inspect run <run_id>
- npx workflow health   # verifies .well-known/workflow endpoints reachable (--port 3001 for non-default)
- npx workflow cancel <run_id>
- npx workflow inspect runs --backend vercel --project <project-name> --team <team-slug> --env preview   # production/preview runs via Vercel CLI auth
- npx workflow --help   # confirm subcommands/flags at install time (CLI flags above come from the vendor skill, not a fetched --help)
- MANUAL: Vercel dashboard -> project -> Observability -> Workflows (trace viewer; step inputs/outputs; decrypted data needs owner or 'Workflow Run Data Viewer' extended permission)
- MANUAL: verify Fluid compute is enabled on the Vercel project (default for new projects; vercel.json {"fluid": true}); without it every workflow resume is a cold start
- MANUAL: read the v5 docs at https://workflow-sdk.dev/v5/docs/... (unversioned /docs/... is v4); context7 id /websites/workflow-sdk_dev_v5

## NON-CONFIRMED FACTS (10 of 38)
- [wrong] The workflow-sdk.dev docs pages cited in PLAN/first pass describe the pinned 5.x version
  TRUTH: docs/source.config.ts maps content/docs/v4 to the unversioned /docs/* URLs ('v4/current') and content/docs/v5 to /v5/docs/* (worlds at /v5/worlds/*). https://workflow-sdk.dev/v5/docs/api-reference/workflow-api/start renders with a v5 label and the v5-only child-run text; the unversioned start page lacks it. Plan authors must read /v5/ pages (context7: /websites/workflow-sdk_dev_v5).
  SRC: https://raw.githubusercontent.com/vercel/workflow/main/docs/source.config.ts; https://github.com/vercel/workflow/tree/main/docs/content/docs; https://workflow-sdk.dev/v5/docs/api-reference/workflow-api/start
- [partially] "use workflow" code cannot use fetch, timers, Buffer, Node modules, or process.env (CLAUDE.md rule 4, PLAN.md:430)
  TRUTH: v5 globals page: unavailable = global fetch ('Use import { fetch } from "workflow" instead'), setTimeout/setInterval/setImmediate + clear*, Buffer ('Use Uint8Array with toBase64()/fromBase64()/toHex()/fromHex()'), Node core modules (fs, path, http, https, net, dns, child_process, cluster, os, stream, node crypto), require(), WeakRef/FinalizationRegistry, async WebAssembly compile/instantiate. BUT 'process.env is available as a read-only, frozen snapshot of the environment variables at the time the workflow was started.' Deterministic/seeded: Math.random, Date (logical clock), crypto.randomUUID, crypto.getRandomValues; crypto.subtle.digest computed synchronously via node:crypto. Available: Headers, TextEncoder/Decoder, URL/URLSearchParams, Request/Response, console, structuredClone, atob/btoa, AbortController/AbortSignal, Promise.all, loops, try/catch.
  SRC: https://workflow-sdk.dev/v5/docs/api-reference/workflow-globals; https://workflow-sdk.dev/v5/docs/foundations/workflows-and-steps
- [wrong] start() inside a workflow must be called from a step (CLAUDE.md rule 4, PLAN.md:431, first-pass 'confirmed')
  TRUTH: v5 changed this. CHANGELOG 5.0.0-beta.3: 'Allow start() to be called directly inside workflow functions'. v5 start page: 'In v5, you can also call start() directly from a workflow function to spawn a child run or continue work in a new run.' and 'It is step-backed, so the spawn records a deterministic step boundary in the parent's event log.' The start() implementation itself begins with 'use step', and workflow/api's "workflow" export condition (dist/api-workflow.js) re-exports the real start and Run while getRun/getHookByToken/resumeHook/resumeWebhook/runStep throw "The workflow environment doesn't allow this runtime usage of X. Move this call to a step function". Inside a workflow 'each Run property access (e.g., run.status, run.returnValue) triggers a workflow step'. Wrapping start() in your own step remains valid (that is all v4 allowed). The vendor skill 0.30.0, upstream skill v1.11 and the unversioned (v4) docs still state the v4 rule.
  SRC: https://raw.githubusercontent.com/vercel/workflow/main/packages/workflow/src/api-workflow.ts; https://raw.githubusercontent.com/vercel/workflow/main/packages/core/src/runtime/start.ts; https://workflow-sdk.dev/v5/docs/api-reference/workflow-api/start; https://raw.githubusercontent.com/vercel/workflow/main/packages/workflow/CHANGELOG.md
- [partially] Step ids are path-based (`step//run-node.ts//runNode`) and renaming runNode or moving its file breaks in-flight runs on deploy (PLAN.md:325, 431; CLAUDE.md rule 4)
  TRUTH: Format is {type}//{modulePath}//{identifier}. The compiler spec says extensions are stripped and local paths get './' (step//./workflows/steps/run-node//runNode); the v5 code-transform docs page shows examples with extensions (step//workflows/user-signup.js//createUser) -- confirm the exact string in `npx workflow inspect run` after first run. On renaming: 'changing IDs won't break old workflows from running, but will prevent runs from being upgraded and will cause your workflow/step names to change in observability across deployments' (atomic versioning: 'Workflow runs are pinned to the deployment that starts them'). So in-flight Vercel runs are NOT broken by a rename; it only matters for start(..., { deploymentId: "latest" }) (keep 'the workflow function name and file path, arguments, and return value backward-compatible') and for the Local World, which has no deployments (workflow-not-registered guidance: 'verify if the workflow was renamed or moved'). Keep the rule as hygiene.
  SRC: https://workflow-sdk.dev/v5/docs/how-it-works/code-transform; https://raw.githubusercontent.com/vercel/workflow/main/packages/swc-plugin-workflow/spec.md; https://raw.githubusercontent.com/vercel/workflow/main/docs/content/docs/v5/foundations/versioning.mdx; https://vercel.com/docs/workflows/concepts#skew-protection
- [unverifiable] Step functions are emitted with maxDuration 'max' (first pass)
  TRUTH: base-builder.ts only writes maxDuration into .vc-config.json when config.maxDuration is explicitly provided; no default seen there. Effective step limit is the Vercel Functions max duration for the plan (Hobby 300s). Check the generated .vercel/output/functions/**/.vc-config.json after the first `next build` on Vercel.
  SRC: https://raw.githubusercontent.com/vercel/workflow/main/packages/builders/src/base-builder.ts; https://vercel.com/docs/workflows/pricing#workflow-run-limits
- [wrong] "DurableAgent" from @workflow/ai is the durable agent class (vendor skill and upstream skill)
  TRUTH: 'DurableAgent is deprecated. Use AI SDK's WorkflowAgent for new durable agents.' @workflow/ai (latest 4.2.1 / beta 5.0.0-beta.15) peers ai ^6 and workflow ^4.8.5 -- incompatible with ai 7 + workflow 5. Migration renames: workflow/ai -> @ai-sdk/workflow; DurableAgent -> WorkflowAgent; system -> instructions; maxSteps -> stopWhen; experimental_output -> output; experimental_context -> runtimeContext + toolsContext. The vendor plugin skill (0.30.0) and upstream skills/workflow/SKILL.md (v1.11) still teach DurableAgent/system/maxSteps and UIMessageChunk.
  SRC: https://workflow-sdk.dev/docs/api-reference/workflow-ai/durable-agent; npm view @workflow/ai peerDependencies --json; https://ai-sdk.dev/docs/agents/workflow-agent; /Users/sonnysangha/.claude/plugins/cache/vercel-vercel-plugin/vercel-plugin/0.30.0/skills/workflow/SKILL.md
- [partially] The vendor plugin skill (vercel-plugin 0.30.0 skills/workflow/SKILL.md) matches the live docs
  TRUTH: Drift found: (1) points to useworkflow.dev / vercel.com/docs/workflow (now workflow-sdk.dev, /docs/workflows); (2) teaches DurableAgent from @workflow/ai/agent with system/maxSteps (deprecated); (3) states 'start() cannot be called directly in workflow context' (v4 rule; v5 allows it); (4) its validate rule flags getWritable() outside 'use step' as wrong, but docs allow obtaining the stream in a workflow (only writes must be in steps); (5) claims Workflow DevKit requires AI Gateway OIDC (not a Workflow docs requirement); (6) does not mention process.env/Math.random/Date determinism. Its core directive/hook/error/serialization/CLI/testing content matches the docs.
  SRC: /Users/sonnysangha/.claude/plugins/cache/vercel-vercel-plugin/vercel-plugin/0.30.0/skills/workflow/SKILL.md; https://raw.githubusercontent.com/vercel/workflow/main/skills/workflow/SKILL.md; https://workflow-sdk.dev/v5/docs/api-reference/workflow/get-writable
- [partially] Scheduler loops up to 500 iterations of computeNext + sleep(Date) + fireSchedule, then 'continue-as-new' by starting itself from a step (PLAN.md:145-161, 445)
  TRUTH: Feasible and matches the documented self-chaining pattern: 'For workflows that chain over extended periods, pass deploymentId: "latest"' so 'the next run picks up new code' (serialized args are the migration boundary). Budget per iteration: computeNext step (3 events) + sleep (2) + fireSchedule step (3, which internally start()s runGraph) = 8 events; 500 iterations = ~4,000 events (< 25k cap, > the 2,000-event slower-replay threshold; every wake replays the loop within the 240s replay limit). Prefer ~200 iterations. PLAN:445 'once-a-minute hits the cap in about a week' is wrong: 25,000/8 = ~3,100 iterations = ~2.2 days without the cutover. Because start() is itself a step, `continueAsNew` can be a plain `await start(scheduler, [args], { deploymentId: 'latest' })` in the workflow body or stay wrapped in a step.
  SRC: https://vercel.com/docs/workflows/pricing#events; https://raw.githubusercontent.com/vercel/workflow/main/docs/content/docs/v5/foundations/starting-workflows.mdx; https://raw.githubusercontent.com/vercel/workflow/main/docs/content/docs/v5/foundations/versioning.mdx
- [unverifiable] Build command on Vercel `npx convex deploy --cmd 'pnpm build'` is compatible with withWorkflow builds (PLAN.md:329, CLAUDE.md:30)
  TRUTH: Workflow docs require only that `next build` runs with withWorkflow in next.config ('do not require any special configuration' on Vercel). Wrapping it in convex deploy --cmd is outside the Workflow docs. Verify on the first preview deploy that the dashboard shows runs and `npx workflow inspect runs --backend vercel --env preview` lists them.
  SRC: https://workflow-sdk.dev/v5/docs/deploying; https://workflow-sdk.dev/v5/docs/getting-started/next
- [partially] Errors are imported from '@workflow/errors' (first pass)
  TRUTH: The documented public path is `import { ... } from "workflow/errors"` (workflow's exports map has "./errors"); @workflow/errors is the transitive package behind it. Classes: WorkflowError, WorkflowWorldError, WorkflowNotRegisteredError, StepNotRegisteredError, WorkflowRunNotFoundError, WorkflowRunFailedError, WorkflowRunCancelledError, WorkflowRunNotCompletedError, WorkflowRuntimeError, RunExpiredError, RunNotSupportedError, HookNotFoundError, HookConflictError, ThrottleError, EntityConflictError, TooEarlyError; each has a static .is(value) (preferred over instanceof across VM boundaries).
  SRC: https://workflow-sdk.dev/docs/api-reference/workflow-errors; npm view workflow@5.0.0-beta.47 exports --json; https://workflow-sdk.dev/v5/docs/api-reference/workflow-errors/workflow-run-failed-error (context7)

## CONFIRMED FACTS
- Install with `npm i workflow@beta` (5.x) for multi-region and @ai-sdk/workflow (PLAN.md:329, CLAUDE.md:12) → npm dist-tags today: latest=4.8.5, beta=5.0.0-beta.47 (published 2026-08-31T23:37Z). Multi-region 'requires workflow version 5.0.0-beta.33 or later'; @ai-sdk/workflow@2.0.21 peerDependency workflow ^5.0.0-beta.42. Pin 5.0.0-beta.47. Both the v4 and v5 getting-
- withWorkflow is imported from workflow/next and wraps next.config (PLAN.md:329) → import { withWorkflow } from "workflow/next"; export default withWorkflow(nextConfig, workflowConfig?). Options: workflows.local.port (number, local only), workflows.sourcemap (boolean | 'inline' | 'linked' | 'external' | 'both'; dev default 'inline', prod def
- Turbopack works in dev and build with withWorkflow → withWorkflow 'Configures webpack and Turbopack loaders to transform workflow code ("use step" and "use workflow" directives)'. The repo's e2e default app is the nextjs-turbopack workbench (APP_NAME="nextjs-turbopack").
- Steps have full Node.js access; importing step functions into a workflow file is the pattern (PLAN.md:268) → 'Full Node.js runtime and npm package access' in steps; steps 'Can be called from workflows or directly outside them' (outside a workflow they run as a normal function). 'Parameters are passed by value, not by reference' -- mutations inside a step are invisibl
- start() import path is workflow/api and it returns a Run with runId (PLAN.md:157, CLAUDE.md:80) → import { start } from "workflow/api"; start(workflowFn, args?: unknown[], options?: StartOptions) -> Promise<Run>. StartOptions (source): deploymentId?: string | 'latest'; region?: string; attributes?: Record<string,string> ('$'-prefixed keys reserved); allowR
- Child workflow results can be awaited from the parent → v5 starting-workflows: 'Awaiting returnValue polls the child run every second, and the polling step holds its worker slot open until the child finishes.' For long-running children 'spawn it without awaiting returnValue and have it resume a hook when it complet
- sleep() is imported from workflow and accepts a Date (PLAN.md:149,155,282) → import { sleep } from "workflow". Source overloads: sleep(duration: StringValue) | sleep(date: Date) | sleep(durationMs: number) -> Promise<void> (docs only show string and Date; number is in the source). Strings: '1000ms', '1s', '1m', '1h', '1d', '7 days'. 's
- `using hook = createHook<HookPayload>({ token })` inside the workflow, then `await hook` (PLAN.md:284-285) → import { createHook } from "workflow"; createHook<T>(options?: { token?: string; experimental_minRetention?: string | number | Date }) -> Hook<T> with token, thenable (await -> first payload), AsyncIterable (for await), dispose(), Symbol.dispose, getConflict()
- resumeHook(token, payload) is called from a Next.js route handler (PLAN.md:327, CLAUDE.md:105) → import { resumeHook } from "workflow/api"; resumeHook<T>(token: string, payload: T): Promise<ResumedHook> (has runId; optional resilientResume flag). 'Must be invoked as a runtime function from outside workflow code' -- in the workflow VM it throws the stub er
- createHook() only in workflow code, never in a step (CLAUDE.md rule 4, PLAN.md:431) → createHook/createWebhook/defineHook().create() are workflow-only ('not available in regular steps'). createWebhook() always generates a random token; 'When using respondWith: "manual", the respondWith() method must be called from within a step function'. defin
- FatalError(msg) for 4xx, RetryableError(msg, { retryAfter }) with a string like "30s" for 429 (PLAN.md:314, CLAUDE.md rule 7) → import { FatalError, RetryableError } from "workflow". new FatalError(message) -> step fails, no retry. new RetryableError(message: string, options?: { retryAfter?: string | number | Date }) -- '5m'/'30s'/'1h', milliseconds, or Date. Step failures propagate in
- Steps retry three times by default (PLAN.md:323) → 'By default, steps retry up to 3 times on arbitrary errors.' 'The default is maxRetries = 3, meaning the step can run up to 4 times total.' Per-step: `callApi.maxRetries = 5;` (property on the step function); `maxRetries = 0` runs once.
- Pause a schedule with getRun(runId).cancel() (PLAN.md:164) → import { getRun } from "workflow/api"; getRun(runId: string): Run is synchronous; 'Only callable in steps and runtime -- not inside workflow functions'. await run.cancel({ cancelReason?: string }) (max 512 chars). run.wakeUp({ correlationIds? }) -> { stoppedCo
- Step arguments and return values are recorded in the run log and visible in the dashboard (CLAUDE.md rule 1, PLAN.md:430) → 'Every step, input, output, sleep, and error inside a workflow is recorded automatically.' step_created 'Contains the step name and serialized input arguments'; step_completed stores the return value; run_created stores input arguments. Team owners and the 'Wo
- Limits: 10,000 steps and 25,000 events per run, 240 seconds max replay, 50 MB payload, no maximum duration (PLAN.md:325) → Vercel table: Events per run 25,000; Steps per run 10,000; Max payload size 50 MB; Max workflow replay duration 240s; Maximum run duration No limit; Maximum sleep duration No limit; Max runtime of individual step = Vercel Functions limits (Fluid: Hobby 300s de
- Hobby includes 50k workflow events a month (PLAN.md:329) → Hobby: 50,000 events/month + 1 GB Workflow Data Written included; Data Retained not available on Hobby. On-demand $0.02/1K events, $0.50/GB written, $0.50/GB-month retained. Retention after completion: Hobby 1 day, Pro 7 days, Enterprise 30 days. A normal step
- Local dev uses the Local World in .workflow-data/ with `npx workflow web` as inspector (PLAN.md:329, CLAUDE.md:24) → 'The Local World is bundled with workflow and used automatically during local development' -- `next dev` alone runs workflows (check the dev server logs). Default dir ./.workflow-data/; env: WORKFLOW_TARGET_WORLD=local, WORKFLOW_LOCAL_DATA_DIR, WORKFLOW_LOCAL_
- Exclude .well-known/workflow/ from the Clerk proxy matcher (PLAN.md:329) → proxy.ts (Next 16; 'proxy.ts replaced middleware.ts') matcher: { source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)" }. 'This ensures that internal Workflow paths are not intercepted by your middleware, which could interfere with work
- On Vercel, Fluid compute on; Workflows is built on Vercel Queues (PLAN.md:329) → 'Vercel Functions execute your workflow and step code. Vercel Queues enqueue and execute those routes with reliability. Managed persistence stores all state and event logs.' Zero config on deploy (Vercel World auto-selected). Fluid compute: recommended, on by 
- @ai-sdk/workflow exists and provides the durable agent (PLAN.md:329) → @ai-sdk/workflow@2.0.21 (repo vercel/ai packages/workflow; engines node>=22; dependency ai 7.0.90; peers workflow ^5.0.0-beta.42, zod ^3.25.76 || ^4.1.8; exports '.', './video'). import { WorkflowAgent } from '@ai-sdk/workflow'. Constructor: model (e.g. 'anthr
- Non-idempotent side effects should use an idempotency key or be guarded by the step record (PLAN.md:323, CLAUDE.md rule 7) → Official pattern: inside the step `const { stepId } = getStepMetadata();` and send 'Idempotency-Key': stepId. getStepMetadata() (steps only; throws elsewhere) returns { stepId, attempt, workflowId, runId }. getWorkflowMetadata() (workflow only) returns workflo
- A Loop over thousands of rows should be a child workflow per chunk via start() from a step, then wait on a hook (PLAN.md:325) → Vercel: 'we recommend creating child workflows to break long-running workflows into smaller pieces'. In v5 the parent may call start() directly (step-backed) or via its own step; waiting on a hook that the child resumes is the documented choice for long childr
- Parallel branches via Promise.all over step calls inside the workflow (PLAN.md:276) → 'Promise.all, and other language primitives' are allowed in workflow functions. Since 5.0.0-beta.20 inline execution runs up to WORKFLOW_MAX_INLINE_STEPS (default 3) steps in parallel per suspension; 5.0.0-beta.43/44 fixed replay-determinism of branch wake ord
- The trace viewer shows every node as runNode because step names are compile-time (PLAN.md:325) → Step name = compile-time id; the dashboard lists it with recorded inputs, so leading nodeId/nodeType args make traces readable. Also: start(..., { attributes: { executionId, orgId } }) seeds plaintext run attributes (filterable via runs.list attributes; '$'-pr
- Workflow SDK's getWritable() streams could drive the live canvas instead of Convex (PLAN.md:321) → import { getWritable } from "workflow"; getWritable<T>({ namespace? }) may be CALLED in workflow or step functions, but 'you cannot interact with the stream directly in the workflow context' -- getWriter/write/close only in steps. Consumers: run.readable or ru
- workflow package Node engine requirement → workflow@5.0.0-beta.47 declares no engines field (peer @opentelemetry/api 1). @ai-sdk/workflow requires node >=22. Vercel builder default runtime 'nodejs22.x'.
- Vitest can unit-test steps directly (CLAUDE.md:27) → Without the compiler 'use step' is a no-op, so steps are plain async functions in unit tests. Integration tests: @workflow/vitest (beta 5.0.0-beta.47) plugin workflow(), helpers waitForHook(run, { token? }) and waitForSleep(run); vi.mock does not work in integ
- `import { fetch } from "workflow"` is available for HTTP inside workflow bodies → Documented in the workflow package reference ('Make HTTP requests from within a workflow with automatic retry semantics'); note packages/core/src/index.ts does not export fetch -- it is added by the `workflow` package's workflow-condition build (dist/workflow.

## SNIPPETS
### next.config.ts + proxy.ts matcher (Next 16)
```
// next.config.ts
import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default withWorkflow(nextConfig, {
  // workflows: { sourcemap: 'inline' | 'linked' | 'external' | 'both' | boolean, local: { port: number } }
});

// proxy.ts (Next 16; replaced middleware.ts) -- Clerk matcher must skip SDK routes
export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/).*)" }],
};
// symptom if missed: "[local world] Queue operation failed ... detached ArrayBuffer" on POST /.well-known/workflow/v1/flow
```
### Core imports (verified export names and paths)
```
import { sleep, fetch, createHook, defineHook, createWebhook, getWritable } from "workflow";
import { FatalError, RetryableError, getStepMetadata, getWorkflowMetadata, setAttributes } from "workflow";
import { start, getRun, resumeHook, resumeWebhook, getHookByToken } from "workflow/api";
import { WorkflowRunFailedError, HookNotFoundError } from "workflow/errors"; // .is(err); errorCode 'USER_ERROR'|'RUNTIME_ERROR'
import { withWorkflow } from "workflow/next";
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow"; // NOT DurableAgent / @workflow/ai
// In "use workflow" bodies only `start` (step-backed) from workflow/api works; getRun/resumeHook/resumeWebhook/getHookByToken throw.
```
### start() signature and Run (from source)
```
import { start } from "workflow/api";
// runtime (route handler / server action), inside a "use step", OR directly in a "use workflow" body (v5: step-backed)
const run = await start(runGraph, [{ executionId, graph, trigger }], {
  // deploymentId?: string | "latest"; region?: "sfo1";
  attributes: { executionId, orgId },        // plaintext run metadata, filterable in observability; no '$' keys
});
run.runId;                    // string
await run.status;             // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
await run.returnValue;        // polls every second until complete (holds a worker slot when awaited inside a workflow)
await run.exists; await run.createdAt; await run.startedAt; await run.completedAt; await run.workflowName;
run.getReadable({ startIndex: -10, namespace: "steps" });
```
### getRun / cancel / wakeUp (steps and runtime only, never in a workflow body)
```
import { getRun } from "workflow/api";
const r = getRun(runId);                                // synchronous
await r.cancel({ cancelReason: "paused by user" });     // reason <= 512 chars
const { stoppedCount } = await r.wakeUp({ correlationIds: [sleepId] }); // omit options to wake all sleeps
if ((await r.status) === "failed") { /* ... */ }
```
### Child workflow / continue-in-new-run (v5)
```
import { start } from "workflow/api";
import { createHook } from "workflow";

export async function parent(args: ParentArgs) {
  "use workflow";
  // v5: direct call is step-backed. Do NOT await child.returnValue for long children.
  const child = await start(childWorkflow, [args.chunk]);
  using done = createHook<{ ok: boolean }>({ token: `chunk-done:${args.executionId}:${args.chunkIndex}` });
  const result = await done;   // child resumes this hook from one of its steps via resumeHook()
  return result;
}

// scheduler self-chaining ("continue as new"): last line of the loop body
// await start(scheduler, [{ scheduleId, cron }], { deploymentId: "latest" }); // picks up new code; keep name/path/args compatible
```
### sleep() accepted arguments
```
import { sleep } from "workflow";
// inside "use workflow" only (special step)
await sleep("30s");                 // StringValue: "1000ms" | "1s" | "1m" | "1h" | "1d" | "7 days"
await sleep(5_000);                 // number = milliseconds (source overload; docs show only string/Date)
await sleep(new Date(nextAtIso));   // Date; Vercel: 'Maximum sleep duration: No limit'
```
### createHook / resumeHook
```
// workflows/run-graph.ts ("use workflow" body only)
import { createHook } from "workflow";
using hook = createHook<HookPayload>({ token: `${executionId}:${nodeId}` }); // token <= 255 bytes
const payload = await hook;                 // first payload; or: for await (const p of hook) {...}
const owner = await hook.getConflict();     // null when registered, or the Run that owns the token

// app/api/slack/interactivity/route.ts (runtime only; throws inside a workflow VM)
import { resumeHook } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
export async function POST(req: Request) {
  const { token, approved, by } = await req.json();
  try {
    const { runId } = await resumeHook<HookPayload>(token, { approved, by });
    return Response.json({ ok: true, runId });
  } catch (e) {
    if (HookNotFoundError.is(e)) return new Response("Hook not found", { status: 404 });
    throw e;
  }
}
```
### defineHook (typed alternative)
```
import { defineHook } from "workflow";
export const approvalHook = defineHook<{ approved: boolean; by: string }>();
// or: defineHook({ schema: z.object({ approved: z.boolean(), by: z.string() }) })  // Standard Schema v1

// in workflow:
const events = approvalHook.create({ token: `approval:${executionId}` });
for await (const ev of events) { if (ev.approved) break; }

// in route handler:
await approvalHook.resume(`approval:${executionId}`, { approved: true, by: "U123" });
```
### Errors, retries and idempotency
```
import { FatalError, RetryableError, getStepMetadata } from "workflow";

export async function runNode(input: NodeInput) {
  "use step";
  const { stepId, attempt } = getStepMetadata();          // stepId -> 'Idempotency-Key' header for non-idempotent writes
  // ...
  if (status === 429) throw new RetryableError("Rate limited", { retryAfter: "30s" }); // "30s" | ms number | Date
  if (status >= 400 && status < 500) throw new FatalError("Bad input");                 // no retry
  throw new Error("5xx");                                                               // default: 3 retries (4 attempts)
}
runNode.maxRetries = 5; // per-step override; 0 = run once
```
### Workflow-body rules (v5 globals)
```
// Allowed in "use workflow": Promise.all, loops, try/catch, Math.random/Date/crypto.randomUUID (seeded, replay-safe),
// process.env (READ-ONLY frozen snapshot), Headers/URL/Request/Response/TextEncoder/structuredClone/atob/btoa/console.
// Not allowed: global fetch (use import { fetch } from "workflow" or a step), setTimeout/setInterval/setImmediate,
// Buffer (use Uint8Array + toBase64()/fromBase64()), Node core modules, require(), WeakRef/FinalizationRegistry, async WebAssembly.
// Step args/returns are serialized by value; mutations inside a step are invisible to the workflow.
```
### WorkflowAgent (replaces DurableAgent)
```
import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import { isStepCount } from "ai";

export async function agentWorkflow(messages: ModelMessage[]) {
  "use workflow";
  const agent = new WorkflowAgent({
    model: "anthropic/claude-sonnet-4-6",     // gateway id or provider instance
    instructions: "You are helpful.",         // not `system`
    tools: { lookup: { description: "...", inputSchema: z.object({ q: z.string() }), execute: lookupStep, needsApproval: false } },
    stopWhen: isStepCount(10),                 // not `maxSteps`
    // runtimeContext / toolsContext must be serializable (no clients, functions)
  });
  const result = await agent.stream({ messages, writable: getWritable<ModelCallStreamPart>() });
  return result.messages; // { messages, steps, toolCalls, toolResults, output }; no generate()
}
```
### Step id format (compiler)
```
// workflows/steps/run-node.ts  export async function runNode(...) { "use step"; ... }
// compiler spec => "step//./workflows/steps/run-node//runNode"  (v5 docs page shows "step//workflows/user-signup.js//createUser"; confirm with `npx workflow inspect run <id>`)
// workflows/run-graph.ts       export async function runGraph(...) { "use workflow"; ... } => "workflow//./workflows/run-graph//runGraph"
// Renaming changes the id: old runs keep running on their pinned deployment; run upgrades (deploymentId:"latest") and observability names break.
```
### Streaming from steps (optional alternative to Convex subscriptions)
```
import { getWritable } from "workflow";
async function emit(chunk: StepEvent) {
  "use step";
  const w = getWritable<StepEvent>({ namespace: "steps" }).getWriter();
  try { await w.write(chunk); } finally { w.releaseLock(); }
}
// consumer: getRun(runId).getReadable({ namespace: "steps", startIndex: 0 })  // streams bypass the event log
```
### Local dev env (Local World)
```
# .env.local (all optional)
WORKFLOW_TARGET_WORLD=local            # forced automatically in dev
WORKFLOW_LOCAL_DATA_DIR=./.workflow-data
WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS=true
# Vercel backend from local CLI only: WORKFLOW_VERCEL_ENV, WORKFLOW_VERCEL_AUTH_TOKEN, WORKFLOW_VERCEL_PROJECT, WORKFLOW_VERCEL_TEAM
```
