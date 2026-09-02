# PapaFlow

n8n-style workflow automation SaaS. Users (as Clerk organisations) bring their own AI keys, connect chat apps, and build workflows either on a React Flow canvas or by describing them to a Pro-only Builder agent. Every run is durable on Vercel Workflows. Working title.

The full plan with research, connector matrices, code sketches and gotchas is in `docs/PLAN.md`. Read it before starting any phase. This file is the short version plus the rules.

## Stack (decided, don't relitigate)

- Next.js (App Router) on Vercel, Fluid compute
- Convex for all app state and realtime (`useQuery` subscriptions drive the canvas)
- Clerk: Organizations for workspaces, Clerk Billing (B2B) for plans, native Convex integration (session token carries `aud: "convex"`)
- Vercel Workflows / Workflow SDK (`workflow@5.0.0-beta.47`; `npm i workflow` installs 4.x — always `workflow@beta`; read only https://workflow-sdk.dev/v5/docs/ or `node_modules/workflow/docs`, the unversioned /docs/ pages are v4) for durable runs, hooks and sleep
- eve (Vercel's agent framework, beta, Node 24) for the Runtime agent (Agent node) and the Builder agent
- AI SDK 7 with direct provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc.) built per call from the org's decrypted key
- React Flow (`@xyflow/react` v12), zod, Resend for app-owned email

Pin exact versions: `next 16.3.4`, `react 19.2.8`, `convex 1.45.0`, `@clerk/nextjs 7.8.4`, `@clerk/backend 3.17.0`, `@xyflow/react 12.11.6`, `zod 4.5.4`, `ai 7.0.90` (all `@ai-sdk/*` at the versions in docs/research/versions.md), `workflow 5.0.0-beta.47`, `eve 0.49.0`. Toolchain: `typescript` 5.9.3 (never 7 — typescript-eslint peers <6.1.0), `eslint 9.39.5` (never 10 — eslint-config-next plugins peer ^9), `"engines": { "node": "24.x" }`. Never install `@clerk/themes` (Core 2 line; use `@clerk/ui`) or `@workflow/ai` (DurableAgent is deprecated; `WorkflowAgent` from `@ai-sdk/workflow`). Do not upgrade them mid-phase.

## Commands

```bash
pnpm dev              # next dev (+ eve dev server via withEve, + convex dev in another terminal)
pnpm convex:dev       # CONVEX_ALLOW_ANONYMOUS=false npx convex dev (a non-TTY shell without .env.local otherwise creates a silent local anonymous deployment)
pnpm workflow:web     # npx workflow web  (local run inspector)
pnpm typecheck        # tsc --noEmit
pnpm lint
pnpm test             # vitest
```

Build command on Vercel (in `vercel.ts`): `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`. `CONVEX_DEPLOY_KEY` is the only Convex var on Vercel: a production deploy key scoped to Production, a preview deploy key scoped to Preview; `NEXT_PUBLIC_CONVEX_URL` is injected by `convex deploy` at build time.

## Layout

```
app/                      Next.js routes and pages
next.config.mts           withEve(withWorkflow(nextConfig), { agents: { runtime, builder } }) — .mts because eve/next is ESM-only
proxy.ts                  clerkMiddleware(); matcher excludes /_next, static files, .well-known/workflow/ and eve/
connectors/               one file per provider: how a user connects (fields, test call, discover), separate from nodes/
  (app)/w/[workflowId]/   canvas editor
  f/[workflowId]/         public form trigger page
  api/hooks/…             generic webhook trigger
  api/events/{provider}/  signed inbound events (Slack, Discord, Telegram, Stripe, GitHub…)
  api/oauth/{provider}/   authorize + callback
  api/connections/        credential save routes (seal into Convex)
convex/                   schema, queries, mutations, httpAction webhooks (Clerk)
workflows/                "use workflow" functions: run-graph.ts, scheduler.ts
workflows/steps/          "use step" functions: run-node.ts, …
nodes/                    one file per node type (see "Node definition" below), registry.ts
lib/oauth/                generic OAuth2 module + providers.ts configs
lib/vault.ts              AES-256-GCM seal/open (Node crypto)
lib/ai/providers.ts       providerFor(provider, apiKey) → AI SDK model factory
agents/runtime/           eve agent behind the Agent node (agent.ts, instructions.md, tools/, channels/eve.ts)
agents/builder/           eve Builder agent (Pro only) — same layout; tools live in agents/builder/tools/
docs/PLAN.md              the plan
```

## Node definition (the one pattern everything hangs off)

```ts
export const slackPostMessage = defineNode({
  type: "slack.postMessage",
  name: "Slack: Post message",
  category: "communication",
  credential: "slack",                 // connection kind this node needs, or null
  requiresFeature: "pro_connectors",   // Clerk feature slug or null
  inputs: z.object({ channel: z.string(), text: z.string() }),   // generates the config form + JSON Schema for the Builder
  outputs: z.object({ ts: z.string(), channel: z.string() }),    // powers the variable picker
  handle: (out) => null,               // Condition/Switch return the edge handle id to follow
  control: (out) => undefined,         // Wait → { kind: "sleep", ms }, Approval → { kind: "hook" }
  async run({ inputs, credential }) { /* fetch … */ },
});
```

Register in `nodes/registry.ts`. Adding a connector = one file + one registry line. Templates are `{{ nodeId.field }}` resolved by `resolveTemplates()` before `inputs.parse()`.

## Hard rules

1. **Secrets never reach the model, a step argument, a step return value, or a client-visible query.** Workflow SDK records step inputs/outputs in the dashboard. Pass `connectionId`; decrypt inside the step with `vault.openFresh()`. Convex queries that touch `connections` project `label, hint, status, scopes, meta` explicitly and never return the document.
2. **Encryption is AES-256-GCM in Node** (`lib/vault.ts`): random 12-byte IV per row, AAD = `${orgId}:${connectionId}`, KEK from `CREDENTIALS_KEK` env (32 bytes base64), `keyId` stored for rotation. Convex only stores ciphertext.
3. **Gating runs in three layers**: `<Show when={{ feature: "org:…" }}>` in UI, `has()` in routes/server actions, and Convex mutations enforcing `PLAN_LIMITS[planSlug]` plus `runNode` refusing nodes whose `requiresFeature` the org lacks. UI checks alone are decoration.
4. **`"use workflow"` code is orchestration only**: no global `fetch`, timers, `Buffer`, Node modules or `require`; `process.env` is a read-only frozen snapshot; `Math.random`/`Date`/`crypto.randomUUID` are seeded. All I/O in `"use step"`. The Workflow SDK bundler also refuses Node built-ins in any module *reachable* from `runGraph`, and `runNode` imports `nodes/registry`, so nothing under `nodes/` or `connectors/` (or anything they import) may import `node:*` — use Web Crypto (`globalThis.crypto`) and `fetch` there; `node:crypto` stays in `lib/vault.ts` and `lib/signatures/*`, which only routes and `lib/` import. `createHook()` only in workflow code; `start()` from `workflow/api` is step-backed in v5 and may be called in a workflow body or a step, but `getRun`, `resumeHook`, `resumeWebhook`, `getHookByToken` only in steps or route handlers. Don't rename `runNode`/`runGraph` or move their files once runs exist: runs on Vercel keep working on their pinned deployment, but `deploymentId: "latest"` upgrades, observability names and Local World runs break.
5. **Steps talk to Convex with `ConvexHttpClient`** and public mutations that check `args.secret === process.env.ENGINE_SECRET` before calling the internal mutation. Never use `setAdminAuth`.
6. **Signed webhooks**: `await req.text()` first, verify HMAC (Stripe, Slack, GitHub, Airtable, Resend/Svix) or Ed25519 (Discord) on the raw body, then parse. Return 200 immediately and `start()` the run; Slack and Discord give you 3 seconds.
7. **Errors in steps**: throw `FatalError` for 4xx (don't retry), `RetryableError(msg, { retryAfter })` for 429, let 5xx use the default 3 retries. Steps must be safe to re-run: if the step record is already `success`, return the stored output.
8. **eve constraints**: durable tools (those that call `ask()`, `sleep`, `createHook`) must be static files under `agents/<name>/tools/`, never returned from `defineDynamic`. `ask(ctx, req)` is synchronous and returns a thenable Hook — `await` it or `Promise.race` it with `sleep`. `defineDynamic` model handlers on `session.started`/`turn.started` must return model-ID strings; a live AI SDK model built from the org's key may only be returned from `step.started`. Every agent needs `channels/eve.ts` with a Clerk authenticator (`eveChannel({ auth: [clerkAuth(), localDev()] })`) — production fails closed without it. Every Builder tool checks the org's plan in Convex inside `execute`. Builder tools edit workflows only; Runtime agent tools call connectors only.
9. **AI SDK 7 names**: `ToolLoopAgent`, `isStepCount` (not `stepCountIs`), `instructions` (not `system`), `generateText({ output: Output.object({ schema }) })` (not `generateObject`), MCP via `@ai-sdk/mcp`. ESM-only, Node 22+. `tool.needsApproval` is deprecated — use `toolApproval` on `generateText`/`streamText`/`ToolLoopAgent`. `agent.stream()` is async (await it). `generateImage`/`generateSpeech`/`transcribe` are stable exports. Anthropic 5-series models reject `temperature`/`top_p`/`top_k` and (Fable 5.1) forced `toolChoice` with 400 — the LLM node omits them for `anthropic`. Google factory is `createGoogle`. Pin `ai 7.0.90` exactly (required by `@ai-sdk/workflow`).
10. **Clerk Core 3**: `<Show when={…}>` replaced `<Protect>`. Use `has({ feature: "org:slug" })` with the explicit `org:` prefix. Billing types are public beta; `useSubscription` is under `@clerk/nextjs/experimental`. Clerk's auto-created default org plan slug is `free_org` — key `PLAN_LIMITS` on `free_org` | `pro` | `team`. **Clerk is the source of truth for organisations, memberships and billing** (decision 2026-09-02): no Clerk webhook and no mirror tables; Convex reads the `pla`/`fea` session claims in `requireOrg()`, and the engine (no session) calls `clerkClient().billing.getOrganizationBillingSubscription(orgId)` at run start and snapshots `planSlug` on the execution. The Convex integration is Dashboard-only (Activate Convex integration → Frontend API URL); do not create a JWT template (it drops `pla`/`fea`).
11. **Model pickers are populated from each provider's list endpoint at connect time** and cached in `connections.meta.models`. Never hardcode model ids in UI.
12. **Ownership is organisational.** Every table has `orgId`; `createdBy` is informational. Solo users are an org of one.

## Convex tables (initial)

`workflows` (graph JSON + `version`), `executions` (with `planSlug` snapshot), `steps` (one per node per execution), `connections` (ciphertext), `schedules` (with scheduler `runId`), `usage` (runs per month per org), `oauthStates`, `builderSessions`, `webhookEvents` (delivery dedupe for Stripe/GitHub). No Clerk mirror tables.

There is no Clerk webhook: organisations, memberships and plans are read from Clerk (session claims in Convex, `<Show>`/`has()` in the app, Backend API in the engine).

## Build phases (engineering order; PLAN.md has the on-camera order)

Each phase ends green on `pnpm typecheck && pnpm test`, with a manual check listed.

1. **Foundation**: Next.js + Clerk (orgs on) + Convex integration + schema + canvas that saves graph JSON per org. Check: switch org, workflow list changes.
2. **Engine**: `runGraph`, `runNode`, `steps` table, `ENGINE_SECRET` mutation, Manual trigger, HTTP Request node, Send email (Resend) node, live status on canvas. Check: run appears in `npx workflow web`, nodes light up.
3. **Templates + picker**, Set node, Condition, Switch with handles. Check: one branch greys out.
4. **Vault + AI connectors**: `lib/vault.ts`, connections UI with masked list, "Test connection" for OpenAI/Anthropic/Gemini/Groq, LLM / Extract / Classify nodes. Check: swap provider in the dropdown, same workflow runs.
5. **Triggers**: Webhook, Form page, Telegram inbound, Stripe. Check: curl the webhook URL.
6. **Token connectors**: Discord webhook + bot, Telegram send, HTTP-with-connection.
7. **OAuth**: generic module, Slack (channel picker), Notion, Airtable. Check: revoke in Slack → step fails with "needs reconnect".
8. **Control**: Wait (`sleep`), Approval (Slack buttons → `resumeHook`), Wait-for-webhook, Loop (sequential).
9. **Schedules**: scheduler workflow with continue-as-new, pause = cancel.
10. **Runtime agent (eve)**: `withEve`, `agents/runtime`, `defineDynamic` tools from connections, Agent node calling `eve/client`.
11. **Billing**: Clerk plans + features (`clerk enable billing --for orgs`, `clerk config patch`), `<PricingTable>`, `<Show>`, `PLAN_LIMITS`, plan from session claims + Clerk Backend API for the engine, usage counters, gating in `createWorkflow` / `startExecution` / `runNode`.
12. **Builder agent (eve)**: `agents/builder`, editing tools as Convex mutations, `request_connection` with `ask()` + credential widget in the chat panel, `validate_workflow`, `finish`.

Spikes to run before phases 10 and 12 (half a day each, throwaway): eve `withEve` + one durable tool with `ask()` round-tripping to a custom React widget; `defineDynamic` returning per-session tools. Confirm the pinned eve version's API matches `docs/PLAN.md` and update the plan if not.

## Env vars

Next.js/Vercel: `CONVEX_DEPLOY_KEY` (prod key on Production, preview key on Preview), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CREDENTIALS_KEK`, `ENGINE_SECRET`, `APP_ORIGIN`, optional `RESEND_API_KEY` (platform email fallback), optional `AI_GATEWAY_API_KEY` (house model locally; OIDC on Vercel), optional OAuth apps `SLACK_CLIENT_ID/SECRET`, `NOTION_CLIENT_ID/SECRET`, `AIRTABLE_CLIENT_ID/SECRET`, `LINEAR_CLIENT_ID/SECRET`, optional `SCHEDULER_MAX_ITERATIONS` (ticks per scheduler run before continue-as-new; default 200, set to 2 locally to watch a handover). Local only (written by `npx convex dev`): `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`; set `CONVEX_ALLOW_ANONYMOUS=false`. Convex deployment (`npx convex env set`, repeat `--prod`): `CLERK_FRONTEND_API_URL` (issuer for auth.config.ts), `ENGINE_SECRET`. Every third-party credential (AI keys, bot tokens, webhook URLs, signing secrets, OAuth tokens) is a per-org **connection** users add inside the app — never an env var.

## Working style

- Plan mode first for any phase; show the file list and the Convex schema diff before writing.
- Small commits per phase, conventional messages (`feat(engine): …`).
- Prefer `fetch` to provider SDKs inside steps unless the SDK is doing real work (signature verification, multipart).
- When a doc claim in `docs/PLAN.md` turns out wrong against the installed version, fix the code and update the plan in the same commit.
