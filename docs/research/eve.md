# verify:eve

## SUMMARY
eve@0.49.0 is latest (published 2026-09-02T01:47Z; 0.45.0→0.49.0 in 7 days, 19 releases since 0.44.0 on 08-21). Apache-2.0, engines.node ">=24", ESM, beta per vercel.com/docs/eve ("currently in beta ... may change before general availability"). Peer: ai ^7.0.82 (latest 7.0.90). Pin eve@0.49.0, ai@7.0.90, zod@4.5.4. The "beta" dist-tag (0.6.0-beta.20, June 12) is a dead line. Docs ship in node_modules/eve/docs (mirror: github.com/vercel/eve/docs). The brief's local skill path (vercel-plugin/0.30.0/skills/eve) does not exist; the only local eve skill is claude-plugins-official/vercel/0.45.1/skills/eve/SKILL.md and it carries no API claims.

Layout: an agent root holds agent.ts (`export default defineAgent({ model })`, from "eve"), instructions.md, tools/*.ts (filename = tool name), skills/, connections/, channels/. Two agents in one Next app: `withEve(nextConfig, { agents: { runtime: "./agents/runtime", builder: "./agents/builder" } })` from "eve/next"; each mounts at /eve/agents/<name>/eve/v1/*; the agent root is agents/<name>/ directly (demo tree: agents/support/{agent.ts,instructions.md,tools}); do not set eveRoot alongside agents. `next dev` alone starts eve (`eve dev --no-ui --port 0`, random port) and rewrites /eve/** same-origin; EVE_BASE_URL reuses a running server. On Vercel withEve emits services/routes so /eve/** bypasses Next filesystem routing/middleware; in dev it is a rewrite, so exclude /eve/(.*) from the Clerk matcher for parity. Production auth fails closed: add agents/<name>/channels/eve.ts with eveChannel({ auth: [clerkAuthFn, localDev()] }) returning SessionAuthContext (attributes → ctx.session.auth.current.attributes).

Tools: defineTool from "eve/tools"; approval always()/once()/never() from "eve/tools/approval" (responses "approve"/"cancel"). Durable tools: `"use workflow"` first statement of execute, helpers `"use step"`, static files only. CORRECTION: `ask` (from "eve/workflow") is synchronous and returns `Hook<ToolInputResponse>` (thenable) — `await` it or Promise.race with sleep; request = { prompt, display?, options?, allowFreeform? }, answer = { optionId?, text? }; it publishes input.requested. CORRECTION to PLAN: session.started/turn.started model handlers must return model-ID strings; live AI SDK LanguageModel instances only from step.started.

Client: `new Client({ host: `${origin}/eve/agents/runtime`, auth: { bearer }, redirect: "manual" })`; `sessions.create<T>({ message, outputSchema })` → `await response.result()` → { status: "waiting"|"completed"|"failed", message, data?: T, events }. React: useEveAgent from "eve/react" ({ agent, headers }); pending asks are dynamic-tool parts in state "approval-requested" with part.toolMetadata.eve.inputRequest ({ requestId, kind, prompt, options, display, allowFreeform, action: { toolName, callId, input } }); answer with agent.respond([{ requestId, text|optionId }]). withWorkflow composition is undocumented: both wrappers accept object-or-function and return an async function; use withEve(withWorkflow(nextConfig)) and spike it.

## VERSIONS
{
"eve": "0.49.0",
"ai": "7.0.90",
"zod": "4.5.4",
"@vercel/connect": "2.0.1 (peer: eve >=0.13.7, ai ^6 || ^7)",
"workflow": "5.0.0-beta.47 (dist-tag beta; latest stable 4.8.5) \u2014 eve bundles its own Workflow SDK, the app's install is independent",
"node": ">=24 (set package.json engines.node \"24.x\" for Vercel)"
}

## COMMANDS
- npm view eve version dist-tags engines peerDependencies license --json
- npm view eve time --json
- npx eve@latest init .   # adds eve deps to an existing package.json (Phase 10, not now)
- npm install eve@0.49.0 ai@7.0.90 zod@4.5.4   # pin exactly (pnpm add equivalent)
- next dev   # withEve runs `eve dev --no-ui --port 0` and rewrites /eve/** same-origin; EVE_BASE_URL=<url> reuses a running server
- eve dev --port 2000   # standalone only; `eve dev https://app.vercel.app` attaches the TUI to a deployment
- eve info --json   # resolved agent, tools, diagnostics
- eve build && eve start --port 4274   # local prod eve; then next build && next start (proxies to EVE_NEXT_PRODUCTION_PORT, default 4274)
- curl http://localhost:3000/eve/agents/runtime/eve/v1/health
- curl -X POST http://localhost:3000/eve/agents/builder/eve/v1/session -H 'content-type: application/json' -H 'authorization: Bearer <clerk-session-jwt>' -d '{"message":"hi"}'   # returns continuationToken + x-eve-session-id
- curl http://localhost:3000/eve/agents/builder/eve/v1/session/<sessionId>/stream   # NDJSON events
- vercel link   # withEve writes services/routes to .vercel/output/config.json when a linked project is detected
- eve link --project <name> --non-interactive && eve deploy --non-interactive --yes   # standalone agents only; withEve projects deploy with git/vercel deploy
- vercel env pull   # VERCEL_OIDC_TOKEN / AI Gateway creds for local runs
- vercel agent-runs --help   # Agent Runs observability
- MANUAL: set package.json engines.node to "24.x"
- MANUAL: exclude /eve/(.*) from the Clerk proxy matcher; add agents/<name>/channels/eve.ts before the first preview deploy (prod fails closed)
- MANUAL: if Deployment Protection is on, set VERCEL_AUTOMATION_BYPASS_SECRET locally for `eve dev <url>`

## NON-CONFIRMED FACTS (12 of 40)
- [wrong] Local vendor skill at ~/.claude/plugins/cache/vercel-vercel-plugin/vercel-plugin/0.30.0/skills/eve/SKILL.md (brief).
  TRUTH: vercel-plugin/0.30.0/skills/ has no eve folder (it has ai-gateway, ai-sdk, auth, workflow, ...). The only local eve skill is /Users/sonnysangha/.claude/plugins/cache/claude-plugins-official/vercel/0.45.1/skills/eve/{SKILL.md,overlay.yaml,upstream/SKILL.md}. It contains no API guidance (only 'read node_modules/eve/docs' and 'vercel agent-runs --help'); no drift vs live docs to report.
  SRC: ls /Users/sonnysangha/.claude/plugins/cache/vercel-vercel-plugin/vercel-plugin/0.30.0/skills/; ls .../claude-plugins-official/vercel/0.45.1/skills/eve/
- [partially] Builder tools are static files under `agent/tools/` while the Builder lives in agents/builder/ (PLAN.md 71).
  TRUTH: Path is agents/builder/tools/*.ts (the folder named in `agents` IS the agent root). The static-file rule for durable tools still applies.
  SRC: https://api.github.com/repos/vercel/eve/contents/apps/frameworks/next-multi-agent/agents/support; https://raw.githubusercontent.com/vercel/eve/main/docs/tools/workflows.mdx
- [partially] 'It's a separate service, so local dev runs the eve dev server beside next dev; make sure both are up' (PLAN.md 432).
  TRUTH: No second terminal: withEve spawns the eve dev server from `next dev`. Standalone `eve dev` (port $PORT then 2000) is only for agent-only projects. On Vercel it is a separate service in the same deployment; for local `next start` withEve proxies to http://127.0.0.1:4274 (EVE_NEXT_PRODUCTION_PORT; named agents get base+index) and you must run `eve build` + `eve start` yourself.
  SRC: https://raw.githubusercontent.com/vercel/eve/main/apps/frameworks/next/README.md; https://raw.githubusercontent.com/vercel/eve/main/docs/reference/cli.md; packages/eve/src/public/next/index.ts (DEFAULT_EVE_NEXT_PRODUCTION_PORT = 4274, localProductionPortOffset: index)
- [unverifiable] Composition of withEve with withWorkflow (order).
  TRUTH: Undocumented on either side. Facts: withWorkflow(nextConfigOrFn: NextConfig | async fn, { workflows? }) returns an async (phase, ctx) => NextConfig function and sets serverExternalPackages, turbopack.rules, webpack loaders and compiler.runAfterProductionCompile (does not touch rewrites); withEve also accepts object-or-function, returns an async function and merges rewrites (eve rules first in beforeFiles). So `withEve(withWorkflow(nextConfig), { agents })` type-checks and each wrapper sees the other's output. CHANGELOG 0.47.7: 'eve/next prevented from claiming host application's Workflow world' — co-hosting with the app's own Workflow SDK is anticipated. Spike (Phase 10): confirm both /eve/** rewrites and .well-known/workflow routes work under `next dev` and `vercel build`.
  SRC: https://raw.githubusercontent.com/vercel/workflow/main/packages/next/src/index.ts; https://raw.githubusercontent.com/vercel/eve/main/packages/eve/src/public/next/index.ts; https://raw.githubusercontent.com/vercel/eve/main/packages/eve/CHANGELOG.md (0.47.7)
- [partially] What must be excluded from the Clerk proxy/middleware matcher.
  TRUTH: Not stated by eve. In dev the eve routes are Next rewrites (beforeFiles), so proxy.ts/middleware runs on /eve/** requests; on Vercel 'routes public eve endpoints directly to the eve service before applying filesystem routing' so middleware never sees them. Exclude `/eve/(.*)` from the Clerk matcher (covers /eve/v1 and /eve/agents/*), never auth.protect() it, and authenticate inside eve via channels/eve.ts instead.
  SRC: https://raw.githubusercontent.com/vercel/eve/main/apps/frameworks/next/README.md; packages/eve/src/public/next/index.ts (rewrites beforeFiles)
- [partially] Durable tools: execute starts with "use workflow" and can call ask(ctx, { prompt, display: "confirmation", allowFreeform: true }) (PLAN.md 65).
  TRUTH: Correct shape, but `ask` is SYNCHRONOUS: `export function ask(ctx: ToolContext, request: ToolInputRequest): Hook<ToolInputResponse>` — 'returns the hook the answer resumes, as createHook would: await it for the answer, or race it against a sleep for a deadline. Synchronous because a Hook is thenable'. ToolInputRequest = { prompt: string; display?: "confirmation"|"select"|"text"; options?: { id, label, description?, style?: "primary"|"danger"|"default" }[]; allowFreeform?: boolean }; ToolInputResponse = { optionId?: string; text?: string }. Import: `import { ask } from "eve/workflow"` (also exports types ToolInputRequest/ToolInputResponse). "use workflow" must be 'the first statement of execute, or of a top-level async function you reference as execute'; workflow body may import createHook, createWebhook, sleep, FatalError from "workflow"; steps use start/getRun/resumeHook from "workflow/api". Shipped in 0.48.0 ('A tool's execute can now be a Workflow body').
  SRC: https://raw.githubusercontent.com/vercel/eve/main/packages/eve/src/execution/tool-run/messages.ts; https://raw.githubusercontent.com/vercel/eve/main/packages/eve/src/tools/definition.ts; https://raw.githubusercontent.com/vercel/eve/main/docs/tools/workflows.mdx; CHANGELOG 0.48.0
- [wrong] defineDynamic can return an AI SDK model built from the user's key, or a Gateway string with BYOK, per session (PLAN.md 339, 71).
  TRUTH: agent-config.md Serialization rules: session.started and turn.started model handlers 'Must return model ID strings' (or { model, modelContextWindowTokens?, modelOptions? }); 'Return live LanguageModel objects only from step.started'. dynamic-capabilities: 'Runtime-selected models must use string model IDs' and a missing/invalid/throwing selection fails the turn. So a per-org provider instance (createAnthropic({ apiKey })(...)) must come from a step.started handler (runs before every model call); Gateway strings work at session.started. Mid-session model switches re-ingest the prompt cache.
  SRC: https://raw.githubusercontent.com/vercel/eve/main/docs/agent-config.md; https://raw.githubusercontent.com/vercel/eve/main/docs/guides/dynamic-capabilities.md
- [partially] Auth reaches the agent 'with the user's Clerk id in the auth header' (PLAN.md 339).
  TRUTH: A bare id is not an authenticator. 'Eve fails closed by default: production traffic is rejected unless you configure an authenticator that accepts it' (health stays public). Add agents/<name>/channels/eve.ts: `import { eveChannel } from "eve/channels/eve"; import { localDev, type AuthFn } from "eve/channels/auth"`; `AuthFn<TEvent = Request> = (event) => SessionAuthContext | null | undefined | Promise<...>`; export default eveChannel({ auth: [clerkAuth(), localDev()] }). Built-ins: localDev(), vercelOidc(), jwtHmac({ algorithm, issuer, audiences, secret }), jwtEcdsa(), oidc(), httpBasic(), none(); helper extractBearerToken(header). Browser: useEveAgent({ headers: async () => ({ authorization: `Bearer ${token}` }) }) or auth: { bearer }. Note the multi-agent demo ships no channels/ (dev-only); dev works via localDev fallback. Clerk-side verification (@clerk/backend verifyToken) must be confirmed in the Clerk domain.
  SRC: https://raw.githubusercontent.com/vercel/eve/main/docs/guides/auth-and-route-protection.md; packages/eve/src/public/channels/auth.ts (via context7); https://raw.githubusercontent.com/vercel/eve/main/docs/guides/frontend/nextjs.mdx
- [partially] eve/client addressing a named agent behind withEve.
  TRUTH: Client has no agent-name option; routes are fixed and 'The only knob is the host prefix (base URL) or the named-agent prefix (/eve/agents/<name>)'. Use host: `${APP_ORIGIN}/eve/agents/runtime`; verify with GET `${host}/eve/v1/health` in the spike. (A `Client` `agent` field, if present, is not documented — do not rely on it.)
  SRC: packages/eve/src/protocol/routes.ts and docs/guides/frontend/overview.mdx (via context7)
- [partially] Deployment on Vercel: project settings, EVE_* env vars, CLI steps.
  TRUTH: With withEve: one Vercel project, normal git deploy; when a linked project is detected withEve writes services/routes into .vercel/output/config.json (eve build via generated buildCommand; override eveBuildCommand / per-agent buildCommand). No EVE_* var is required in production. Documented vars: EVE_BASE_URL (dev), EVE_NEXT_PRODUCTION_ORIGIN (non-Vercel prod), EVE_NEXT_PRODUCTION_PORT (local next start, 4274), EVE_VERCEL_SCOPE (ACP), EVE_TRACES*, PORT. Gateway auth on Vercel is OIDC. Standalone-only: eve link [--project --team --non-interactive], eve deploy [--non-interactive --yes]. Agent Runs observability: `vercel agent-runs --help`. engines.node '24.x'.
  SRC: https://raw.githubusercontent.com/vercel/eve/main/docs/guides/frontend/nextjs.mdx; https://raw.githubusercontent.com/vercel/eve/main/docs/guides/deployment/vercel.mdx; https://raw.githubusercontent.com/vercel/eve/main/docs/reference/cli.md; https://vercel.com/docs/eve
- [unverifiable] Fallback B 'WorkflowAgent inside the workflow (@ai-sdk/workflow, needs workflow 5 beta)' and CLAUDE.md 'workflow@5 beta line'.
  TRUTH: Outside eve's docs. npm: workflow latest 4.8.5, beta 5.0.0-beta.47 (exports ./next → dist/next.cjs, ./api, ./errors, ./runtime ...). eve's bundled Workflow SDK is internal (deps nitro + undici only), so the app's `workflow` version is independent. Verify @ai-sdk/workflow in the Workflow domain report.
  SRC: npm view workflow dist-tags; npm view workflow@beta exports dependencies; npm view eve dependencies
- [partially] ask_user is a custom Builder tool (PLAN.md 60).
  TRUTH: eve ships a default ask_question tool ({ prompt, options?, allowFreeform? }, kind "question"), so a custom ask_user is only needed for a different widget (match on action.toolName).
  SRC: https://raw.githubusercontent.com/vercel/eve/main/docs/tools/human-in-the-loop.md

## CONFIRMED FACTS
- eve is Vercel's open-source agent framework, Apache-2.0, launched June 2026, still beta (PLAN.md 335; CLAUDE.md 13). → npm license Apache-2.0; vercel.com/docs/eve (last_updated 2026-08-27): 'eve is currently in beta ... The framework, APIs, documentation, and behavior may change before general availability.' Blog 'Introducing eve' published June 17, 2026 (blog itself names no 
- Current version / cadence: 'moved from 0.47 to 0.49 in the two days before this was written', 'versions daily' (PLAN.md 343, 432). → latest 0.49.0 (2026-09-02T01:47:20Z); 0.48.0 2026-09-01; 0.47.7 2026-09-01; 0.47.0 2026-08-27; 0.45.0 2026-08-26; 0.44.0 2026-08-21 — 19 releases in 12 days. dist-tag 'beta' = 0.6.0-beta.20 (2026-06-12, dead line; never use @beta). Pin eve@0.49.0 exactly.
- Node 24 requirement (CLAUDE.md 13, PLAN.md 432). → engines.node '>=24'; eve.dev/docs: 'Node.js 24 or newer'. Package is ESM ('type': 'module'). Set engines.node '24.x' in package.json for Vercel.
- Peer/companion versions to pin (CLAUDE.md 17). → peerDependencies: ai ^7.0.82; optional @opentelemetry/api ^1, braintrust ^3, just-bash ^3.1, microsandbox ^0.5. dependencies: nitro 3.0.260610-beta, undici 8.9.0 (eve bundles its own Workflow SDK; 0.49.0 'Eve's bundled Workflow SDK packages updated to latest 5
- Docs source of truth for the installed version is node_modules/eve/docs/README.md. → Local skill: 'always read the bundled docs, which match the installed version exactly: node_modules/eve/docs/ ... Start with node_modules/eve/docs/README.md'. GitHub mirror: https://github.com/vercel/eve/tree/main/docs (index lists getting-started.mdx, agent-c
- An agent is a directory (agent/instructions.md, agent/agent.ts, agent/tools/*.ts, skills, connections) (PLAN.md 335). → Minimum: agent/instructions.md (mandatory for root agents) + package.json; agent/agent.ts optional but model is required when present: `import { defineAgent } from "eve"; export default defineAgent({ model: "openai/gpt-5.4-mini" })`. tools/<name>.ts → tool <na
- One Next.js app can host two agents, agents/runtime and agents/builder (CLAUDE.md 49-50, PLAN.md 71). → WithEveOptions.agents: Record<string, string | { root: string; buildCommand?: string; servicePrefix?: string }> — 'Named eve agents to mount under /eve/agents/<name>/eve/v1/*'. Demo: withEve(nextConfig, { agents: { support: "./agents/support", billing: { root,
- withEve(nextConfig) import path and 'pnpm dev = next dev (+ eve dev server via withEve)' (CLAUDE.md 22, PLAN.md 335). → `import { withEve } from "eve/next"`. Signature: withEve(configOrFunction: NextConfig | (phase, ctx) => Promise<NextConfig>, options?: { devServerTimeoutMs? (180000), eveRoot?, agents?, eveBuildCommand?, servicePrefix? }) returns an async Next config function.
- HTTP surface is /eve/v1/* (PLAN.md 335). → EVE_ROUTE_PREFIX = "/eve/v1"; routes /eve/v1/session, /session/:sessionId, /session/:sessionId/{stream,cancel,compact,clear,reset}, /eve/v1/health, /eve/v1/info — 'fixed constants ... The only knob is the host prefix (base URL) or the named-agent prefix (/eve/
- Tool definition function is defineTool with a zod inputSchema. → `import { defineTool } from "eve/tools"`; { description, inputSchema: Zod | Standard Schema | JSON Schema, outputSchema?, execute(input, ctx): Promise<T> | T | AsyncIterable<T>, approval?, execution?: "background" (then a `task` fn), toModelOutput?(output) }. 
- `approval: always()`; blog's `needsApproval` is now `approval: always()` (PLAN.md 67, 341, 343). → Blog (June 17) shows `needsApproval: ({ toolInput }) => ...`; current docs: `import { always } from "eve/tools/approval"` (never() default, once(), always(), or custom fn({ session, toolName, toolInput, approvedTools, callId }) → "user-approval" | "not-applica
- eve publishes an `input.requested` event when ask() parks (PLAN.md 65). → 'ask publishes an input.requested event on the session — rendered the way channels render ask_question and tool approvals.' Event payload: event.data.requests: InputRequest[]; the turn parks in session.waiting; answered via session.respond([{ requestId, option
- Durable tools must be static files under agent/tools/, never returned from defineDynamic (CLAUDE.md rule 8, PLAN.md 432). → 'Workflow bodies are for static tools under agent/tools/, not tools returned from defineDynamic resolvers.' (agents/<name>/tools/ in multi-agent mode.)
- defineDynamic exact signature and `session.started` hook (PLAN.md 339). → defineDynamic({ events: { "session.started"?, "turn.started"?, "step.started"? : (event, ctx) => R | Promise<R> } }); precedence step > turn > session; later events replace earlier ones for subsequent model calls. Exported from "eve" (models/subagents), "eve/t
- defineDynamic may return tools, model, instructions, skills. → Models (agent.ts `model:`), subagents (defineAgent/defineRemoteAgent/null), connections (defineMcpClientConnection/defineOpenAPIConnection, set instanceKey), tools, skills (defineSkill/null), instructions (defineInstructions({ content, role? })/null). Dynamic 
- Static model config accepts an AI SDK model instance or a gateway string. → defineAgent({ model: "anthropic/claude-opus-4.8" }) (Gateway; dots in Gateway IDs, hyphens in provider-native IDs) or model: anthropic("claude-opus-4-8"). Other fields: reasoning, modelOptions, compaction { thresholdPercent }, limits { maxInputTokensPerSession
- Tools read the org from ctx.session.auth (PLAN.md 71, 339). → ctx.session = { id, turn: { id, sequence }, auth: { current, initiator }, parent? }. SessionAuthContext = { authenticator: string; principalId: string; principalType: "user"|"app"|"service"; issuer?; subject?; attributes?: Record<string, unknown> }; null on un
- eve/client: client.sessions.create({ message, outputSchema }), await the response, read structured output (PLAN.md 339). → `import { Client } from "eve/client"; new Client({ host, auth?: { bearer: async () => string } | { basic } | { vercelOidc: { token } }, headers?, redirect?: "manual"|"error" })`. `const { session, response } = await client.sessions.create<T>({ message, outputS
- useEveAgent React hook: import path, return shape, pending-ask detection and answering (PLAN.md 65). → `import { useEveAgent } from "eve/react"` (eve/next exports only withEve + types; eve/vue, eve/svelte exist). Options: host, agent, headers (object or async fn, re-resolved per request), auth { bearer }, initialSession { sessionId, streamIndex }, initialEvents
- The chat panel can see the pending ask came from `request_connection` and render its own widget (PLAN.md 65). → inputRequestSchema (strict) = { requestId, kind: "question"|"session-limit"|"tool-approval", prompt, options?: { id, label, description?, style? }[], display?: "confirmation"|"select"|"text", allowFreeform?, action: runtimeToolCallActionRequest { kind: "tool-c
- MCP connections are one defineMcpClientConnection (PLAN.md 341). → `import { defineMcpClientConnection } from "eve/connections"` in agent/connections/<name>.ts: { url, description, auth?: { getToken: async () => ({ token }) } | (ctx) => ({ principalType, getToken }), headers? (static or (ctx) => ...), instanceKey?, approval?,
- @vercel/connect handles third-party OAuth for tools (PLAN.md 341). → `import { connect } from "@vercel/connect/eve"` (subpath exists); auth: connect("linear/myagent") (user-scoped) or connect({ connector: "linear/myagent", principalType: "app" }). @vercel/connect 2.0.1, peers eve >=0.13.7, ai ^6 || ^7.
- Skills as markdown files in agent/skills (PLAN.md 71, 341). → agent/skills/<name>.md (flat; frontmatter optional, first non-empty line = description) or agent/skills/<name>/SKILL.md (frontmatter `description` required; optional license, metadata; references/, assets/, scripts/). TS: `import { defineSkill } from "eve/skil
- Every eve turn already runs as a durable Workflow SDK run (PLAN.md 335). → 'eve checkpoints progress and serializes durable state at each step boundary' (step = one model call + its tool calls); crash 'picks up from the last completed step'; parked work 'holds no compute'. Locally 'persists workflow runs on disk under .eve/.workflow-
- Local dev requirements and the 'Local World'. → Default world: Vercel Workflow on Vercel, SDK local world locally (.eve/.workflow-data; delete to reset). Override: agent.ts experimental.workflow.world. Sandbox only if a tool calls ctx.getSandbox() (defaultBackend: Vercel Sandbox deployed, else Docker/micros
- 'Tool closures must be JSON-serializable, so each tool's execute receives a connectionId and decrypts inside' (PLAN.md 339). → 'Closure values must be JSON-serializable ... Functions, class instances, Date, Map, symbols, non-finite numbers, and cyclic values fail resolution.' A captured connectionId string is fine; a decrypted key would be persisted in durable descriptors, so decrypt 
- Sessions are durable and multi-turn ('make it post to Discord instead' is the next message) (PLAN.md 71). → Sessions 'span days and weeks'; session.send() continues; React resume via initialSession + resume: true; 0.49.0: session creation returns as soon as Workflow accepts the run.
- AI SDK 7 pairing (CLAUDE.md 14, PLAN.md 343). → peer ai ^7.0.82; provider instances from @ai-sdk/* accepted as `model` (statically or from step.started).

## SNIPPETS
### next.config.ts — two agents in one Next.js app (withWorkflow order is a spike item)
```
import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {};

// both wrappers accept a config object or async config fn and return an async fn;
// withWorkflow sets serverExternalPackages/turbopack/webpack, withEve adds /eve/** rewrites
export default withEve(withWorkflow(nextConfig), {
  agents: {
    runtime: "./agents/runtime", // /eve/agents/runtime/eve/v1/*
    builder: "./agents/builder", // /eve/agents/builder/eve/v1/*
  },
  // never combine with eveRoot
});
```
### agents/builder/agent.ts — model selection rules
```
import { defineAgent, defineDynamic } from "eve";

export default defineAgent({
  model: defineDynamic({
    events: {
      // session/turn handlers: model-ID STRING (or { model, modelContextWindowTokens?, modelOptions? })
      "session.started": (_event, ctx) =>
        ctx.session.auth.initiator?.attributes?.plan === "pro"
          ? "anthropic/claude-sonnet-5"
          : "openai/gpt-5.4-mini",
      // live AI SDK LanguageModel (org's own key) ONLY here:
      // "step.started": async (_event, ctx) => createAnthropic({ apiKey })("claude-sonnet-5"),
    },
  }),
  limits: { sessionTimeoutMs: 7 * 24 * 60 * 60 * 1000 },
});
```
### agents/builder/tools/request_connection.ts — durable tool; ask() returns a thenable Hook
```
import { defineTool } from "eve/tools";
import { ask } from "eve/workflow"; // ask(ctx, req): Hook<{ optionId?: string; text?: string }>
import { sleep } from "workflow";
import { z } from "zod";

async function confirmOwned(connectionId: string, orgId: string) {
  "use step"; // I/O only in steps
  return { connectionId, label: "Slack: papafam" };
}

export default defineTool({
  description: "Ask the user to connect a provider. Returns the connectionId.",
  inputSchema: z.object({ provider: z.string(), kind: z.enum(["oauth", "apiKey", "webhook"]).optional() }),
  async execute(input, ctx) {
    "use workflow";
    const answer = await Promise.race([
      ask(ctx, {
        prompt: `Connect ${input.provider}`,
        display: "confirmation",
        allowFreeform: true,
        options: [{ id: "cancel", label: "Cancel", style: "danger" }],
      }),
      sleep("24h").then(() => ({ optionId: "cancel" as const })),
    ]);
    if (answer.optionId === "cancel" || !answer.text) return { cancelled: true };
    return await confirmOwned(answer.text, String(ctx.session.auth.current?.attributes?.orgId));
  },
});
```
### agents/builder/tools/remove_node.ts — approval gate
```
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval"; // never() default, once(), always()
import { z } from "zod";

export default defineTool({
  description: "Remove a node from the workflow.",
  inputSchema: z.object({ nodeId: z.string() }),
  approval: always(), // client answers optionId "approve" | "cancel"
  async execute({ nodeId }, ctx) {
    const orgId = ctx.session.auth.current?.attributes?.orgId;
    return { removed: nodeId };
  },
});
```
### agents/runtime/tools/connectors.ts — per-session dynamic (non-durable) tools
```
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const orgId = String(ctx.session.auth.current?.attributes?.orgId);
      const connections = await listActiveConnections(orgId); // [{ id, provider }]
      // map keys become tool names verbatim (no file-slug prefix)
      return Object.fromEntries(
        connections.map((c) => [
          `${c.provider}_send`,
          defineTool({
            description: `Send via ${c.provider}`,
            inputSchema: z.object({ text: z.string() }),
            execute: async ({ text }) => sendWith(c.id, text), // closure holds only the id string
          }),
        ]),
      );
    },
  },
});
```
### agents/<name>/channels/eve.ts — route auth (production fails closed without it)
```
import { eveChannel } from "eve/channels/eve";
import { extractBearerToken, localDev, type AuthFn } from "eve/channels/auth";
// AuthFn<TEvent = Request> = (event) => SessionAuthContext | null | undefined | Promise<...>

function clerkAuth(): AuthFn<Request> {
  return async (request) => {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (!token) return null; // skip → next authenticator
    const claims = await verifyClerkSessionToken(token); // Clerk domain: confirm @clerk/backend verifyToken
    if (!claims) return null;
    return {
      authenticator: "clerk",
      issuer: claims.iss,
      principalId: claims.sub,
      principalType: "user",
      subject: claims.sub,
      attributes: { orgId: claims.org_id, plan: claims.pla }, // → ctx.session.auth.current.attributes
    };
  };
}

export default eveChannel({ auth: [clerkAuth(), localDev()] });
```
### Agent node step — eve/client with structured output
```
import { Client } from "eve/client";
import { z } from "zod";

const client = new Client({
  host: `${process.env.APP_ORIGIN}/eve/agents/runtime`, // client appends /eve/v1/...
  auth: { bearer: async () => await mintServiceToken() },
  redirect: "manual",
});

const outputSchema = z.object({ summary: z.string(), score: z.number() });
const { session, response } = await client.sessions.create<z.infer<typeof outputSchema>>({
  message: prompt,
  outputSchema, // JSON Schema or Standard Schema; per-turn; server validates
});
const result = await response.result(); // { status: "waiting"|"completed"|"failed", message, data?, events }
if (result.status !== "completed" || !result.data) throw new Error(result.status);
return result.data;
```
### Chat panel — useEveAgent, detect request_connection, answer it
```
"use client";
import { useEveAgent } from "eve/react"; // NOT eve/next
import type { InputRequest } from "eve/client";

const agent = useEveAgent({
  agent: "builder",
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
});

const pending: InputRequest[] = agent.data.messages
  .flatMap((m) => m.parts)
  .flatMap((p) =>
    p.type === "dynamic-tool" && p.state === "approval-requested" && p.toolMetadata?.eve?.inputRequest
      ? [p.toolMetadata.eve.inputRequest]
      : [],
  );
// InputRequest: { requestId, kind: "question"|"tool-approval"|"session-limit", prompt, options?, display?, allowFreeform?, action: { kind: "tool-call", toolName, callId, input } }
const connReq = pending.find((r) => r.action.toolName === "request_connection");

await agent.respond([{ requestId: connReq!.requestId, text: newConnectionId }]); // after the widget saved the secret
await agent.respond([{ requestId: connReq!.requestId, optionId: "cancel" }]);    // cancel
await agent.respond([{ requestId, optionId: "approve" }]);                        // approval: always()
```
### MCP connection + Vercel Connect
```
import { defineMcpClientConnection } from "eve/connections";
import { connect } from "@vercel/connect/eve";

export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description: "Linear workspace.",
  auth: connect("linear/papaflow"), // or { getToken: async () => ({ token }) } / (ctx) => ({ principalType: "user", getToken })
});
```
### Skill files
```
// agents/builder/skills/slack.md  (flat: first non-empty line = description)
Use the Slack: Post message node for notifications; prefer a channel picker over hardcoded ids.

// agents/builder/skills/slack/SKILL.md (packaged: frontmatter description required)
---
description: How and when to use the Slack node.
---
```
