# PapaFlow

n8n-style workflow automation SaaS. Users (as Clerk organisations) bring their own AI keys, connect chat apps, and build workflows either on a React Flow canvas or by describing them to a Pro-only Builder agent. Every run is durable on Vercel Workflows. Working title.

The full plan with research, connector matrices, code sketches and gotchas is in `docs/PLAN.md`. Read it before starting any phase. This file is the short version plus the rules.

## Stack (decided, don't relitigate)

- Next.js (App Router) on Vercel, Fluid compute
- Convex for all app state and realtime (`useQuery` subscriptions drive the canvas)
- Clerk: Organizations for workspaces, Clerk Billing (B2B) for plans, native Convex integration (session token carries `aud: "convex"`)
- Vercel Workflows / Workflow SDK (`workflow@5` beta line) for durable runs, hooks and sleep
- eve (Vercel's agent framework, beta, Node 24) for the Runtime agent (Agent node) and the Builder agent
- AI SDK 7 with direct provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, etc.) built per call from the org's decrypted key
- React Flow (`@xyflow/react` v12), zod, Resend for app-owned email

Pin exact versions of `eve`, `workflow`, `@clerk/nextjs`, `@clerk/backend`, `ai`. Do not upgrade them mid-phase.

## Commands

```bash
pnpm dev              # next dev (+ eve dev server via withEve, + convex dev in another terminal)
pnpm convex:dev       # npx convex dev
pnpm workflow:web     # npx workflow web  (local run inspector)
pnpm typecheck        # tsc --noEmit
pnpm lint
pnpm test             # vitest
```

Build command on Vercel: `npx convex deploy --cmd 'pnpm build'`. Production and preview Convex deploy keys are separate.

## Layout

```
app/                      Next.js routes and pages
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
agents/runtime/           eve agent behind the Agent node
agents/builder/           eve Builder agent (Pro only)
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
4. **`"use workflow"` code is orchestration only**: no `fetch`, timers, `Buffer`, Node modules, `process.env`. All I/O in `"use step"`. `createHook()` only in workflow code; `start()` inside a workflow only from a step. Don't rename `runNode` or move its file once runs exist (step ids are path-based).
5. **Steps talk to Convex with `ConvexHttpClient`** and public mutations that check `args.secret === process.env.ENGINE_SECRET` before calling the internal mutation. Never use `setAdminAuth`.
6. **Signed webhooks**: `await req.text()` first, verify HMAC (Stripe, Slack, GitHub, Airtable, Resend/Svix) or Ed25519 (Discord) on the raw body, then parse. Return 200 immediately and `start()` the run; Slack and Discord give you 3 seconds.
7. **Errors in steps**: throw `FatalError` for 4xx (don't retry), `RetryableError(msg, { retryAfter })` for 429, let 5xx use the default 3 retries. Steps must be safe to re-run: if the step record is already `success`, return the stored output.
8. **eve constraints**: durable tools (those that call `ask()`, `sleep`, `createHook`) must be static files under `agent/tools/`, never returned from `defineDynamic`. Every Builder tool checks the org's plan in Convex inside `execute`. Builder tools edit workflows only; Runtime agent tools call connectors only.
9. **AI SDK 7 names**: `ToolLoopAgent`, `isStepCount` (not `stepCountIs`), `instructions` (not `system`), `generateText({ output: Output.object({ schema }) })` (not `generateObject`), MCP via `@ai-sdk/mcp`. ESM-only, Node 22+.
10. **Clerk Core 3**: `<Show when={…}>` replaced `<Protect>`. Use `has({ feature: "org:slug" })` with the explicit `org:` prefix. Billing types are public beta; `useSubscription` is under `@clerk/nextjs/experimental`.
11. **Model pickers are populated from each provider's list endpoint at connect time** and cached in `connections.meta.models`. Never hardcode model ids in UI.
12. **Ownership is organisational.** Every table has `orgId`; `createdBy` is informational. Solo users are an org of one.

## Convex tables (initial)

`organizations`, `memberships`, `orgPlans` (synced from Clerk webhooks), `workflows` (graph JSON + `version`), `executions`, `steps` (one per node per execution), `connections` (ciphertext), `schedules` (with scheduler `runId`), `usage` (runs per month per org), `oauthStates`, `builderSessions`.

Clerk webhook (`organization.*`, `organizationMembership.*`, `subscription*.*`) lands on a Convex `httpAction` at `https://<deployment>.convex.site/clerk-webhook`, verified with `svix`.

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
11. **Billing**: Clerk plans + features, `<PricingTable>`, `<Show>`, `PLAN_LIMITS`, webhook sync, usage counters, gating in `createWorkflow` / `startExecution` / `runNode`.
12. **Builder agent (eve)**: `agents/builder`, editing tools as Convex mutations, `request_connection` with `ask()` + credential widget in the chat panel, `validate_workflow`, `finish`.

Spikes to run before phases 10 and 12 (half a day each, throwaway): eve `withEve` + one durable tool with `ask()` round-tripping to a custom React widget; `defineDynamic` returning per-session tools. Confirm the pinned eve version's API matches `docs/PLAN.md` and update the plan if not.

## Env vars

`CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `CLERK_*`, `CLERK_WEBHOOK_SIGNING_SECRET`, `CREDENTIALS_KEK`, `ENGINE_SECRET`, `RESEND_API_KEY`, `SLACK_CLIENT_ID/SECRET/SIGNING_SECRET`, `NOTION_CLIENT_ID/SECRET`, `AIRTABLE_CLIENT_ID/SECRET`, `DISCORD_APP_ID/PUBLIC_KEY/BOT_TOKEN`, `HOUSE_AI_API_KEY` (Builder fallback model, per-org cap). Convex-side secrets are set with `npx convex env set`.

## Working style

- Plan mode first for any phase; show the file list and the Convex schema diff before writing.
- Small commits per phase, conventional messages (`feat(engine): …`).
- Prefer `fetch` to provider SDKs inside steps unless the SDK is doing real work (signature verification, multipart).
- When a doc claim in `docs/PLAN.md` turns out wrong against the installed version, fix the code and update the plan in the same commit.
