# PapaFlow — the rebuild prompt

> **How to use this file.** Start a fresh Claude Code session in an **empty directory** and paste
> everything below the horizontal rule as the first message. It is self-contained: it does not
> assume access to the original repository. Where it says "verbatim", copy the block exactly.
> Expect the full build to take a long session with many phases; the prompt tells the agent
> where it must stop and wait for you. A two-paragraph version lives in
> [`REBUILD-PROMPT-SHORT.md`](REBUILD-PROMPT-SHORT.md).

---

You are building **PapaFlow** from scratch: an n8n-style, multi-tenant workflow-automation SaaS
where organisations bring their own AI keys and app credentials, draw workflows on a canvas (or
have an AI builder draw them), publish them so webhooks / forms / schedules / chat events start
them, and every run executes durably. Build the whole product end to end — engine, UI, billing,
agents, marketing pages, docs — to the specification below. Treat every section as a
requirement, not a suggestion. Where the spec quotes code, match it; where it describes
behaviour, match the behaviour.

## 0. Working rules (read before anything else)

1. **Never guess an API.** Before writing code against any library, read the installed package's
   own docs and types (`node_modules/<pkg>/docs`, `dist/*.d.ts`) or the current official docs.
   Your training data is stale for every library here. For the Workflow SDK read **only**
   `https://workflow-sdk.dev/v5/docs/` (the unversioned pages are v4). For eve read
   `node_modules/eve/docs/README.md` and `https://eve.dev/docs`.
2. **Pin exact versions** (section 2). Do not upgrade anything mid-build.
3. **Secrets never pass through chat.** When you need a platform secret, print the variable name
   and where it comes from, then stop and wait for me to add it to `.env.local`. Verify presence
   by variable name only (`grep -c '^NAME=' .env.local`). Generate app-internal secrets yourself
   with `openssl rand -base64 32`.
4. **Plan each phase before coding it**: list the files and the Convex schema diff, then build.
   End every phase green on `pnpm typecheck && pnpm lint && pnpm test`, do the phase's manual
   check in a real browser, and make one conventional commit (`feat(engine): …`).
5. **Every third-party credential is a per-organisation connection added inside the app** —
   never an env var. The product must work for a signed-in org with zero operator-configured
   third-party apps.
6. **Clerk is the source of truth** for organisations, memberships and billing. No mirror tables,
   no Clerk webhook.
7. When a doc claim turns out wrong against the installed version, fix the code and the doc in
   the same commit.
8. Stop points — the only reasons to pause: a value only I can supply, a dashboard-only step, or
   me creating a test connection in the running app. At each one print the exact variable
   name / dashboard path and keep building everything that does not depend on it.

## 1. What you are building

**Surfaces**

- Public: landing page (`/`), pricing (`/pricing`), docs (`/docs`), sign-in / sign-up /
  select-organisation, a hosted form page per Form-triggered workflow (`/f/<workflowId>`).
- App (signed in, active organisation required): workflow list (`/w`), canvas editor
  (`/w/<id>`), per-workflow run history (`/w/<id>/runs`), organisation run history (`/runs`),
  connections (`/connections`), settings (`/settings`) and plans (`/settings/billing`).
- Two AI agents: a **Runtime agent** behind the *AI Agent* node whose tools are the org's
  connections, and a **Builder agent** (Pro) that edits the workflow in a chat panel beside the
  canvas.

**Capabilities**

- 27 node types (6 triggers, 7 logic, 4 AI, 10 actions), 21 connectors, 13 templates.
- Durable runs on Vercel Workflows: retries, pauses of days, human approval via chat buttons,
  wait-for-callback, sequential loops.
- Publishing model: a workflow is `draft` until Published; only then do its triggers fire.
- Schedules with Convex as the alarm clock (one scheduled job per published schedule).
- Bring-your-own keys sealed with AES-256-GCM, opened only inside the step that uses them.
- Three org plans on Clerk Billing (`free_org`, `pro`, `team`) gating features on three layers.
- Live canvas: nodes and edges light up as steps run; a runs timeline under the canvas; runs
  pages with stats, filters, pagination and a step-level detail sheet.
- Fully responsive down to 320px, light/dark/system theme.

## 2. Stack and exact versions (non-negotiable)

| Area | Packages |
| --- | --- |
| Framework | `next 16.3.4`, `react 19.2.8`, `react-dom 19.2.8`, `typescript 5.9.3` (never 7), `eslint 9.39.5` (never 10), `eslint-config-next 16.3.4`, `@types/node 24.13.3`, `@types/react 19.2.18`, `@types/react-dom 19.2.5`. `"engines": { "node": "24.x" }`, `packageManager: pnpm@11.24.0`. React Compiler on. |
| UI | `tailwindcss 4.3.3` + `@tailwindcss/postcss 4.3.3`, `shadcn 4.20.0` CLI (**Base UI**, `init -d`; use `render={…}` never `asChild`), `next-themes 0.4.6`, `lucide-react 1.39.0`, `sonner 2.0.8`, `@xyflow/react 12.11.6`, `react-markdown 10.1.0`, `remark-gfm 4.0.1` |
| State | `convex 1.45.0`, `convex-test 0.0.56`, `@edge-runtime/vm 5.0.0`, `vitest 4.1.11`, `vite-tsconfig-paths 6.1.1` |
| Auth / billing | `@clerk/nextjs 7.8.4`, `@clerk/backend 3.17.0` (Core 3). Never `@clerk/themes`. |
| Runs | `workflow 5.0.0-beta.47` (install as `workflow@beta`; plain `workflow` installs 4.x) |
| Agents | `eve 0.49.0` (never `eve@beta`; Node ≥ 24, ESM-only) |
| AI | `ai 7.0.90` (exact), `zod 4.5.4`, `@ai-sdk/openai 4.0.56`, `@ai-sdk/anthropic 4.0.48`, `@ai-sdk/google 4.0.62`, `@ai-sdk/xai 4.0.53`, `@ai-sdk/mistral 4.0.39`, `@ai-sdk/groq 4.0.37`, `@ai-sdk/deepseek 3.0.39`, `@ai-sdk/elevenlabs 3.0.37`, `@ai-sdk/fal 3.0.37`, `@ai-sdk/mcp 2.0.43`, `@ai-sdk/gateway 4.0.72`, `@openrouter/ai-sdk-provider 3.0.0` |
| Misc | `croner 10.0.1` (cron → next date), `@vercel/config 0.7.0` (`vercel.ts`) |

AI SDK 7 names: `ToolLoopAgent`, `isStepCount`, `instructions` (not `system`),
`generateText({ output: Output.object({ schema }) })` / `Output.choice`, `toolApproval` (not
`needsApproval`), `await agent.stream()`, `createGoogle`, `createDeepSeek`, `createOpenRouter`.
Anthropic 5-series models reject `temperature` / `top_p` / `top_k` and forced `toolChoice` — omit
them for `anthropic`.

Clerk Core 3 names: `<Show when={…}>` (not `<Protect>`), `has({ feature: "org:slug" })` with the
explicit `org:` prefix, `await auth()`, `await clerkClient()`, `proxy.ts` (not `middleware.ts`),
`CheckoutButton` / `PlanDetailsButton` / `SubscriptionDetailsButton` / `usePlans` /
`useSubscription` from `@clerk/nextjs/experimental`.

## 3. Architecture

```
Browser (Next.js 16 App Router, React Flow canvas, Convex useQuery subscriptions)
   │ session token: org id + `pla` (plan) + `fea` (features) claims
   ├─► Clerk — auth, organisations, billing
   ├─► Convex — every table, every live subscription, the schedule alarm clock
   ├─► Next.js route handlers & server actions — Run, Publish, connections, webhooks, forms
   │       └─► start(runGraph) on Vercel Workflows
   │              runGraph ("use workflow": orchestration only)
   │                 └─► runNode ("use step": ALL I/O, idempotent, opens the credential)
   │                        ├─► markStep → Convex (ENGINE_SECRET-guarded mutation) → canvas lights up
   │                        ├─► provider APIs (fetch)
   │                        └─► eve Runtime agent (AI Agent node)
   └─► eve Builder agent (chat panel) → Convex mutations with source: "builder"
Convex scheduled job ──► POST /api/engine/schedule-tick ──► startRun
Providers ──signed webhooks / form posts──► route handlers ──► startRun
```

Principles: orchestration and I/O never mix; a `connectionId` travels, a secret never does;
Publish is the only switch for triggers; Convex is the alarm clock; Clerk is the source of truth;
gate three times and trust only the last two; identity comes from Clerk, never from the model.

## 4. Repository layout

```
app/
  layout.tsx, providers.tsx (ClerkProvider > ConvexProviderWithClerk > ThemeProvider > TooltipProvider + Toaster)
  (marketing)/{layout,page,pricing/page,docs/page}.tsx      public shell (SiteHeader/SiteFooter)
  sign-in/[[...sign-in]]/page.tsx  sign-up/[[...sign-up]]/page.tsx  select-org/page.tsx
  (app)/layout.tsx                      auth() guard → /sign-in or /select-org; <Header/> + <main>
  (app)/w/page.tsx  (app)/w/[workflowId]/page.tsx  (app)/w/[workflowId]/runs/page.tsx
  (app)/runs/page.tsx  (app)/connections/page.tsx  (app)/settings/page.tsx  (app)/settings/billing/page.tsx
  f/[workflowId]/page.tsx               public form page
  api/hooks/[workflowId]/[secret]/route.ts        generic webhook trigger
  api/forms/[workflowId]/route.ts                 form submit → run
  api/events/slack/route.ts                       ONE stable Slack endpoint (matches by team.id)
  api/events/slack/[connectionId]/route.ts        legacy per-connection Slack
  api/events/{discord,telegram,stripe}/[connectionId]/route.ts
  api/wait/[token]/route.ts                       wait-for-callback resume
  api/connections/route.ts  api/connections/[id]/route.ts  api/connections/[id]/pick/route.ts
  api/engine/{run,publish,schedule-tick}/route.ts ENGINE_SECRET-guarded, session-less callers
  api/schedules/route.ts  api/builder/session/route.ts
proxy.ts  next.config.mts  vercel.ts  vitest.config.mts  components.json  .env.example
convex/   schema.ts auth.config.ts lib/auth.ts workflows.ts executions.ts steps.ts engine.ts
          connections.ts schedules.ts usage.ts oauthStates.ts builder.ts plan.ts crons.ts *.test.ts
workflows/ run-graph.ts ("use workflow")  steps/run-node.ts ("use step")  steps/record.ts  graph.ts  types.ts
nodes/    define.ts registry.ts categories.ts templates.ts  triggers/ logic/ ai/ actions/
connectors/ define.ts registry.ts <provider>.ts × 21
lib/      engine-client.ts engine-env.ts vault.ts envelope.ts plans.ts billing.ts publish-server.ts
          schedules-server.ts schedule.ts connections-server.ts slack-events.ts eve.ts templates.ts
          validate-workflow.ts ai/{providers,validate,key-shape,model-list}.ts signatures/* oauth/*
agents/runtime/  agent.ts instructions.md tools/ channels/eve.ts lib/
agents/builder/  agent.ts instructions.md tools/ channels/eve.ts lib/
components/ ui/ (shadcn) shared/ app/ canvas/ workflows/ runs/ connections/ billing/ marketing/ forms/
tests/    flat *.test.ts(x) files (vitest "unit" project); convex/**/*.test.ts (vitest "convex" project)
docs/     PLAN.md PROVISIONING.md research/*.md
```

## 5. Config files (verbatim)

```ts
// proxy.ts — Clerk's default matcher would intercept the Workflow SDK and eve endpoints; exclude them.
import { clerkMiddleware } from "@clerk/nextjs/server";
export default clerkMiddleware(); // protects nothing; pages/routes call auth() themselves
export const config = {
  matcher: [
    "/((?!_next|\\.well-known/workflow/|eve/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
```

```ts
// next.config.mts — .mts because eve/next is ESM-only
import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";
const nextConfig: NextConfig = { reactCompiler: true };
export default withEve(withWorkflow(nextConfig), {
  agents: { runtime: "./agents/runtime", builder: "./agents/builder" },
});
```

```ts
// vercel.ts
import type { VercelConfig } from "@vercel/config/v1";
export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL",
  functions: { "app/api/**/route.ts": { maxDuration: 300 } },
};
```

```ts
// convex/auth.config.ts — native Clerk integration; NO JWT template (it drops pla/fea)
export default { providers: [{ domain: process.env.CLERK_FRONTEND_API_URL!, applicationID: "convex" }] };
```

`package.json` scripts: `dev: next dev`, `build: next build`, `lint: eslint`,
`typecheck: tsc --noEmit`, `test: vitest run`,
`convex:dev: CONVEX_ALLOW_ANONYMOUS=false npx convex dev`, `workflow:web: npx workflow web`.
`vitest.config.mts`: two projects — `unit` (node env, `tests/**/*.test.{ts,tsx}` +
`{lib,nodes,workflows,connectors}/**/*.test.ts`) and `convex` (edge-runtime env,
`convex/**/*.test.ts`), with `vite-tsconfig-paths`. `.gitignore` adds `.workflow-data/`, `.eve/`.

## 6. Data model (Convex)

Every table carries `orgId` (the Clerk organisation id) and is indexed by it. No user, org,
membership or plan tables.

| Table | Fields | Indexes |
| --- | --- | --- |
| `workflows` | `orgId, createdBy, name, description?, graph { nodes: any[], edges: any[], viewport?, triggerId? }, version: number, status: "draft"\|"active"\|"paused", webhookSecret: string (32+ chars), lastEditSource?: "canvas"\|"builder", lastEditedBy?, updatedAt` | `by_org`, `by_org_updated` |
| `executions` | `orgId, workflowId, workflowVersion, planSlug, status: "queued"\|"running"\|"waiting"\|"completed"\|"failed"\|"cancelled", trigger { type: string, payload: any }, runId?, startedBy?, startedAt, finishedAt?, error?` | `by_org`, `by_workflow`, `by_runId`, `by_org_started`, `by_workflow_started` |
| `steps` | `orgId, executionId, nodeId, nodeType, status: "running"\|"success"\|"failed"\|"waiting"\|"skipped", attempt, input?, output?, error?, warnings?: string[], handle?, hookToken?, iteration?, parentStepId?, startedAt, finishedAt?` | `by_execution`, `by_execution_node`, `by_org`, `by_hookToken` |
| `connections` | `orgId, createdBy, provider, kind: "apiKey"\|"oauth2"\|"webhookUrl"\|"botToken"\|"signingSecret", label, secret: { v: 1, keyId, iv, tag, ct }, hint (last 4 chars), externalId?, expiresAt?, scopes: string[], meta: any, status: "active"\|"needs_reconnect"\|"revoked", requiresFeature?, updatedAt` | `by_org`, `by_org_provider`, `by_provider_external` |
| `schedules` | `orgId, workflowId, cron, timezone?, enabled, jobId?: Id<"_scheduled_functions">, nextAt?, plannedAt?, lastFiredAt?, lastError?, attempts?, updatedAt` | `by_org`, `by_workflow` |
| `usage` | `orgId, month ("2026-09"), runs, builderTurns, houseModelCalls` | `by_org_month` |
| `oauthStates` | `orgId, userId, provider, state, codeVerifier?, redirectTo?, expiresAt` | `by_state`, `by_expiresAt` |
| `builderSessions` | `orgId, userId, workflowId, eveSessionId, status: "active"\|"finished"\|"cancelled", createdAt, updatedAt` | `by_org`, `by_workflow`, `by_eveSessionId` |
| `webhookEvents` | `source, eventId, receivedAt` (delivery dedupe) | `by_source_event` |

Graph node shape stored in `workflows.graph.nodes[]`:
`{ id, type: "papaflow", position: {x,y}, width?, height?, data: { nodeType, key, label, inputs } }`
where `key` matches `/^[a-z][a-z0-9_]*$/`, is unique per workflow and is what templates address
(`{{ key.field }}`). Edges: `{ id, source, target, sourceHandle? }`. Runtime-only fields
(`status`, `durationMs`, setup state) are stripped before saving.

`convex/lib/auth.ts#requireOrg(ctx)` reads the identity: org id from `org_id` / `o.id` / parsed
`o` claim (accept only values matching `/^org_[A-Za-z0-9]+$/`), role, `plan` from the `pla`
claim (`"o:pro"` → `"pro"`, unknown → `free_org`), `features` from `fea` (`"o:a,o:b"`) falling
back to the plan's feature list. Every query/mutation starts with it. Engine mutations in
`convex/engine.ts` are public but check `args.secret === process.env.ENGINE_SECRET` then delegate
to internal functions; never `setAdminAuth`.

`connections.list` returns an explicit projection — `_id, _creationTime, provider, kind, label,
hint, status, scopes, expiresAt, requiresFeature, updatedAt, createdBy, meta` — never the document.

`workflows.list` returns a summary per workflow: `_id, name, status, version, updatedAt,
schedule: { cron, nextAt? } | null, triggerNodeType, lastRun: { status, startedAt, finishedAt?,
error? } | null, recentRuns[] (newest 8), runCount7d` (one indexed executions scan per row).
`executions.pageByOrg` / `pageByWorkflow` use `paginationOptsValidator`, project out
`trigger.payload`, and respect the plan's history window (7 days, 30 with `run_history_30d`);
`listByWorkflow` / `listByOrg` (take 50) and `latestByWorkflow` also exist for the canvas.

## 7. Node system

Every node is one file calling `defineNode`:

```ts
export interface NodeDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  type: string; name: string; description: string;
  category: "trigger" | "logic" | "ai" | "chat" | "data" | "action";
  guide?: { summary: string; steps?: string[]; labels?: Record<string, string> }; // "How this node works"
  icon: string;                       // lucide icon name
  credential: string | null;          // connection provider slug, "any" (HTTP), "chat" (Approval), or null
  credentialOptional?: boolean;
  requiresFeature: string | null;     // Clerk feature slug
  version: "v1" | "v2";
  inputs: I;                          // generates the config form, JSON Schema for the Builder, runtime validation
  outputs: O;                         // powers the variable picker
  handles?: (inputs) => string[];     // source handle ids; default ["out"]
  handle?: (out) => string | null;    // which handle fired
  control?: (out) => { kind: "sleep"; ms: number } | { kind: "hook" } | undefined;
  expand?: (inputs) => unknown[];     // For each → items
  children?: (out) => { name; input?; output?; error? }[]; // AI Agent → one nested step per tool call
  run(ctx: { inputs; credential?; orgId; executionId; nodeId; planSlug?; hookToken?; stepId? }): Promise<z.infer<O>>;
}
export class ConnectorError extends Error { constructor(message: string, public status: number, public retryAfter?: string) }
```

Field metadata via zod `.meta()`: `label`, `picker` (`"models" | "channels" | "chats" | "bases" |
"tables:{baseId}" | "dataSources" | "targets" | "teams"`), `keyPicker`
(`"fields:{baseId}:{tableId}"`, `"properties:{dataSourceId}"`), `showWhen`, `options`. The
config form renders string / number / boolean / enum / textarea / JSON / key-value list / typed
field-list inputs from the schema, with a connection picker when `credential` is set and a
variable picker on every text field.

**Registry**: `nodes/registry.ts` exports `NODES` (built from a `DEFINITIONS` array; duplicate
types throw) and `nodeCatalogue(features)` (`type, name, description, category, icon, version,
requiresFeature, allowed, credential, credentialOptional, inputsSchema, outputsSchema, handles`).
Nothing under `nodes/` or `connectors/` may import `node:*` (the Workflow bundler refuses it);
use Web Crypto and `fetch` there. AI provider packages load lazily inside `providerFor`.

**The 27 nodes** (type · name · inputs · outputs · handles/control):

*Triggers* — `manual.trigger` Manual trigger (`sample` JSON string, default `"{}"`; output = the
parsed sample) · `webhook.trigger` Webhook (no inputs; `body, headers, query, method`) ·
`form.trigger` Form (`title, description?, fields[{name, label, type: text|email|textarea|number|select, required, options?}], submitLabel`; `values, submittedAt`) ·
`schedule.trigger` Schedule (`mode: every|cron, everyMinutes 1–1440, cron?, timezone?`; `firedAt, scheduleId`) ·
`telegram.message` Telegram message (`connectionId`; `update, chatId, text?, from`) ·
`stripe.event` Stripe event (`connectionId, eventTypes[]`; `event, type, object`).

*Logic* — `logic.condition` "If… then" (`left, operator: equals|notEquals|contains|notContains|greaterThan|lessThan|isEmpty|isNotEmpty|matchesRegex, right`; handles `true`/`false`, labelled yes/no) ·
`logic.switch` "Route by value" (`value, cases[]`; handles = cases verbatim + `default` shown as "otherwise") ·
`logic.set` "Set values" (`fields[{key, value}]` → object) ·
`logic.wait` "Pause" (`mode: duration|until, seconds ≥1 default 30, until?`; `control: sleep`) ·
`logic.waitForWebhook` "Wait for a callback" (`control: hook`; resume URL `/api/wait/<hookToken>`; outputs `body, headers`) ·
`logic.approval` "Ask for approval" (`credential: "chat"`; `connectionId, target (picker targets), message, approveLabel, rejectLabel`; handles `approved`/`rejected`; `control: hook`; the branch comes from the resumed payload; buttons render in Slack (Block Kit), Discord (components) and Telegram (inline keyboard), and the button press resumes the hook) ·
`logic.loop` "For each item" (`items` JSON array or `{{ path }}`; handles `each`/`done`; one linear chain after `each` runs once per item with `{{ $item }}` bound; `{{ loopKey.results }}` / `.count` after `done`).

*AI* — `ai.llm` (`connectionId, model (picker models), instructions?, prompt, maxOutputTokens default 1024, temperature?`; `text, finishReason, usage`) ·
`ai.classify` (`connectionId, model, text, labels[≥2], instructions?`; `label`) ·
`ai.extract` (`connectionId, model, prompt, fields[{name, type: string|number|boolean|string[], description?}]`; object) ·
`ai.agent` (feature `ai_agent`; `connectionId, model, goal, maxSteps 1–50 default 8, outputFields[]`; `text, result, toolCalls[]`; `children` = tool calls).

*Chat* — `slack.postMessage` (Pro; `connectionId, channel (picker), text, blocks?`) ·
`discord.postMessage` (`connectionId, channelId? (picker), content?, embedTitle?, embedDescription?, embedUrl?`) ·
`telegram.sendMessage` (`connectionId, chatId (picker chats, DMs first), text, parseMode: HTML|MarkdownV2|none`) ·
`teams.postCard` (`connectionId, title, text`).

*Data* — `notion.createPage` (Pro; `connectionId, dataSourceId (picker), title, properties[{key (keyPicker), value}]`, typed values, `Notion-Version: 2026-03-11`, `parent: { data_source_id }`) ·
`airtable.createRecord` (Pro; `connectionId, baseId, tableId, fields[{key (keyPicker), value}]`; refuse an all-empty row) ·
`linear.createIssue` (Pro; `connectionId, teamId (picker), title, description?`) ·
`github.createIssue` (`connectionId, title, body?, labels[]`).

*Actions* — `http.request` (`credential: "any"`, optional; `connectionId?, method, url, auth: bearer|header|none, authHeader, headers, body?`; `status, headers, body`) ·
`email.send` (`credential: "resend"`, optional; `connectionId?, to, subject, text, from?`; falls back to the platform `RESEND_API_KEY`, and in Resend's sandbox sends from `onboarding@resend.dev` to the account owner's address only).

**Templates / variables** (`nodes/templates.ts`): path lookups only, no expressions.
`{{ nodeKey.path[0].field }}`, `{{ trigger.… }}`, `{{ $item }}`. A field that is entirely one
placeholder keeps the referenced value's type (arrays stay arrays); a placeholder inside longer
text is stringified; a missing path resolves to `""` and records a warning
`{{ a.b }}: not found` on the step. The context per node is
`{ ...outputsByNodeKey, trigger: trigger.payload, $item }`. Trigger payload by how the run
started: Run button → the sample object itself; form → `{ values, submittedAt }`; webhook →
`{ method, headers, query, body }`; schedule → `{ firedAt, scheduleId }`; telegram →
`{ update, chatId, text, from }`; stripe → `{ event, type, object }`. The trigger node's own
step row holds the same payload, so `{{ form.values.email }}` works too.

`lib/validate-workflow.ts#validateWorkflow(graph, { features })` reports: unknown node type,
feature the plan lacks, zod input issues (ignoring `{{ … }}` placeholders), a required
credential with a blank `connectionId`, empty graph, no trigger, more than one trigger, an edge
to a missing node, an edge on a handle the source does not offer, an orphan node.

## 8. Connectors

`defineConnector({ provider, name, category: ai|chat|data|email|payments, kind, requiresFeature,
fields: [{ name, label, kind: secret|text|url, placeholder?, help?, required? }], docsUrl, icon,
test(secret) → { ok, label, hint, meta } | { ok: false, error }, externalIdFrom?, pick?(kind,
secret, meta) → [{ id, label, type?, choices? }], emptyHint?(kind), setup?, afterCreate?({
connectionId, secret, appOrigin }) → { secret?, meta? } })`.

The 21 connectors and what the user pastes:

| Provider | Kind | Fields | `test()` / `discover` |
| --- | --- | --- | --- |
| openai, anthropic, google, xai, mistral, groq, deepseek, openrouter, elevenlabs, fal | apiKey | API key (Anthropic also an optional `workspaceId` text field) | provider list-models endpoint → `meta.models` (OpenAI `GET /v1/models` filtered to text models; Anthropic `GET /v1/models?limit=1000` with `x-api-key` + `anthropic-version: 2023-06-01` and `anthropic-workspace-id` when set; Google `GET /v1beta/models?pageSize=1000` filtered to `generateContent`; xAI `/v1/api-key` then language models, refuse blocked keys; Mistral/Groq/DeepSeek `/models`; OpenRouter `/api/v1/key`; ElevenLabs `/v1/user`; fal a cheap image call) |
| slack | botToken | bot token `xoxb-…`, signing secret | `auth.test` → `meta.team_id` (copied to `externalId`), channels via `conversations.list`, DM targets via `users.list`; a copy-paste **app manifest** (scopes `chat:write, chat:write.public, channels:read, groups:read, users:read`, request URL `{{APP_ORIGIN}}/api/events/slack` substituted client-side) |
| discord-webhook | webhookUrl | webhook URL | GET the webhook |
| discord-bot | botToken | bot token, application id, public key | `GET /users/@me`, guild channels, DM targets (`user:<id>`) |
| telegram | botToken | BotFather token | `getMe`; `afterCreate` calls `setWebhook` with a per-connection secret (Web Crypto); chats learned from inbound updates |
| teams | webhookUrl | Power Automate workflow URL | POST a test card |
| notion | apiKey | `ntn_…` | `GET /v1/users/me`; data sources via search; property picker |
| airtable | apiKey | PAT | `GET /v0/meta/whoami`; bases, tables, fields via Meta API |
| linear | apiKey | `lin_api_…` | `{ viewer { id } }`; teams |
| github | apiKey | fine-grained PAT + `owner/repo` | `GET /user` + repo check |
| stripe | signingSecret | `whsec_…` | verified on first delivery |
| resend | apiKey | key (+ from address) | `GET /domains` |

Key hygiene: normalise every typed field (`trim`, strip matching surrounding quotes); a
key-shape check before any network call names an Anthropic Admin key (`sk-ant-admin…`), a Claude
Code OAuth token (`sk-ant-oat…`), or a key pasted into the wrong provider; surface the provider's
own error text (key scrubbed) with advice appended when Anthropic asks for
`anthropic-workspace-id`; log `{ provider, status, keyLength }` on refusal, never the key.

Create sequence (`POST /api/connections`, Node runtime): `has()` for `requiresFeature` →
normalise → `test()` → insert a placeholder row (to get the id the AAD needs) → `afterCreate` →
seal with the real id → patch; on any failure remove the row. Response `{ id, label }`.
`DELETE /api/connections/:id`, re-test, and `POST /api/connections/:id/pick` (server-side, fresh
token, returns non-secret lists only).

OAuth (`lib/oauth`) is an optional second path: buttons render only when
`SLACK_CLIENT_ID/SECRET`, `NOTION_…`, `AIRTABLE_…`, `LINEAR_…` exist; PKCE S256 for Airtable;
Notion has no `expires_in` (refresh on 401); Linear tokens rotate; Slack redirect URLs must be
HTTPS.

## 9. Engine (durable runs)

`workflows/run-graph.ts` — `export async function runGraph({ executionId, orgId, planSlug, graph,
trigger }) { "use workflow"; … }`. Frontier walk: run every ready node through `runNode` (with
`Promise.all` per frontier); on `control.kind === "sleep"` record a suspend, `await sleep(ms)`,
record the wake; on `control.kind === "hook"` `using hook = createHook<HookPayload>({ token:
hookTokenFor(executionId, nodeId) })`, record the suspend, `output = await hook`, derive the
handle from the payload, record the resume; for a loop run the `each` chain once per item
sequentially with `$item` bound and per-pass step rows (`iteration`), then continue from `done`;
follow `nextNodes(graph, nodeId, handle)`; mark untaken branches `skipped`; finish `completed` or
`failed` (rethrow). Imports only `workflow` (`sleep`, `createHook`) and steps. Never rename or
move it: its id `workflow//./workflows/run-graph//runGraph` is permanent, as is the step id
`step//./workflows/steps/run-node//runNode`.

`workflows/steps/run-node.ts` — `"use step"`. `console.log` at entry and exit with
`executionId`, `nodeId` and the attempt from `getStepMetadata()` (the only way to debug a hang
in the run inspector). In order: look up the definition (`FatalError` on
unknown); **idempotency** — if the step row for `(executionId, nodeId, iteration)` is already
`success`, return its stored output/handle/control; feature gate against the plan snapshotted on
the execution (`FatalError("Upgrade required: …")`); mark `running`; `resolveTemplates` then
`def.inputs.parse`; open the credential with `openFresh(connectionId)` and re-check
`row.orgId === orgId` (`FatalError("connection not found")`); run; mark `success` with output,
warnings, handle; map errors — `ConnectorError` 429 → `RetryableError(msg, { retryAfter })`,
other 4xx and zod errors → `FatalError`, anything else rethrown for the default 3 retries;
produce friendly messages (`"<node label>" is not set up yet — <field>: <issue>`). Children
(agent tool calls) become nested step rows with `parentStepId`.

Steps write through `lib/engine-client.ts` (`ConvexHttpClient` built per call, never a module
singleton; reads `CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL` **literally**) to
`api.engine.markStep`, `finishExecution`, `recordResume`, etc., each guarded by `ENGINE_SECRET`.

`startRun({ orgId, workflowId, trigger, startedBy?, planSlug })`: load the workflow, build the
run graph, apply the Manual trigger's sample when the payload is empty, create the execution
(which counts the run in `usage` and can refuse with `run_limit`), write the trigger's own step
row, `start(runGraph, [input], { attributes: { executionId, orgId } })`, store `runId`.

Run inspector: `pnpm workflow:web` locally; production runs visible in the Vercel dashboard.

## 10. Triggers, publishing, inbound events

- **Run** (toolbar) starts the workflow in any status, using the Manual trigger's sample. A Form-
  triggered workflow opens a dialog with the form's own fields and submits `{ values, submittedAt }`.
- **Publish** (`lib/publish-server.ts#applyPublish`, shared by the server action and
  `POST /api/engine/publish`): sets `status: "active"` and arms the schedule if the graph has a
  Schedule trigger; **Unpublish** sets `paused` and disarms. `draft` is the initial state.
- Unpublished behaviour: webhook `409 not_published`; form page renders with a banner and a
  submit gets `409`; schedule tick refused (`409`) and Convex disarms; Telegram/Stripe events are
  not listed as listeners but the provider still gets `200`. URLs exist before publishing.
- Webhook route: constant-time secret compare (one 404 for "no such workflow" and "wrong
  secret"), payload `{ method, headers, query, body }`, `202 { executionId }`, `429 run_limit`.
- Signed inbound events: read `await req.text()` first, verify over those bytes (Slack HMAC with
  timestamp, Discord Ed25519, Telegram `X-Telegram-Bot-Api-Secret-Token`, Stripe signature with
  tolerance), then parse; answer within 3 s; Stripe deduped on `event.id` per connection in
  `webhookEvents`. Slack has one stable endpoint `/api/events/slack` that reads `team.id` from
  the raw body, looks up connections by `externalId`, verifies with that connection's signing
  secret, handles `url_verification` challenges, routes interactivity (approval buttons) to
  `resumeHook` and message events to matching published workflows.
- `/api/wait/<token>` resumes a Wait-for-callback with the posted body (drops `x-clerk-*`
  headers).

## 11. Schedules — Convex is the alarm clock

Publishing a workflow with a Schedule trigger writes a `schedules` row and arms one Convex
scheduled job: `ctx.scheduler.runAt(nextAt, internal.schedules.fire, { scheduleId, plannedAt,
attempt: 0 })`, storing `jobId`. `fire` claims the tick and POSTs
`${APP_ORIGIN}/api/engine/schedule-tick` with `Authorization: Bearer ${ENGINE_SECRET}` and
`{ scheduleId, workflowId, orgId, plannedAt }`. The route re-checks the row (enabled, matching
workflow/org), the workflow (`active`), computes the next occurrence **from now** with `croner`
(`lib/schedule.ts#nextFireTime`), calls `startRun` (swallowing `run_limit` into
`{ started: false, reason: "run_limit" }`), and answers `200 { started, executionId?, nextAt }`.
Convex reads the answer: 200 → record the tick and arm `nextAt`; 404/409 → disarm with a
`lastError`; 5xx/network → retry the same tick three times a minute apart, then arm a 15-minute
fallback. Unpublish cancels the job. The Convex deployment needs `APP_ORIGIN` and `ENGINE_SECRET`
of its own; the cloud dev deployment cannot reach `localhost` (use `npx convex dev --local` or a
tunnel). Plan floor: `minScheduleMinutes` (60 on Free, 1 on Pro/Team), enforced when arming.
The Schedule node's panel shows the armed state, next fire time and last error.

## 12. Vault and secrets

`lib/envelope.ts`: AES-256-GCM, 12-byte random IV per call, KEK from `CREDENTIALS_KEK` (32 bytes
base64), AAD `${orgId}:${connectionId}`, envelope `{ v: 1, keyId: "k1", iv, tag, ct }`.
`lib/vault.ts#openFresh(connectionId)` reads the sealed row via the engine, refuses
`needs_reconnect` / `revoked`, and returns `{ orgId, provider, kind, secret, meta, status }`.
Only steps and routes open credentials; `node:crypto` lives only in `lib/vault.ts`,
`lib/envelope.ts` and `lib/signatures/*`. Nothing secret is ever logged, echoed, put in a step
argument or result, sent to a model, or returned by a query; `hint` (last four characters) is
the only fragment that exists in the clear.

## 13. Auth, tenancy, billing

- Clerk organisations are the tenants; there is no personal-account mode. `(app)/layout.tsx`
  redirects to `/sign-in` without a user and to `/select-org` without an active org.
- Plans and features live in `lib/plans.ts`:

```ts
export const FEATURES = {
  free_org: ["core_connectors"],
  pro: ["core_connectors","pro_connectors","ai_agent","ai_builder","schedules","run_history_30d"],
  team: ["core_connectors","pro_connectors","ai_agent","ai_builder","schedules","run_history_30d","shared_connections","audit_log","priority_runs"],
} as const;
export const PLAN_LIMITS = {
  free_org: { workflows: 3,        runsPerMonth: 100,    members: 1,        minScheduleMinutes: 60 },
  pro:      { workflows: Infinity, runsPerMonth: 5_000,  members: 5,        minScheduleMinutes: 1 },
  team:     { workflows: Infinity, runsPerMonth: 50_000, members: Infinity, minScheduleMinutes: 1 },
};
export const PRICING = { free_org: { monthly: 0, annual: 0 }, pro: { monthly: 29, annual: 24 }, team: { monthly: 99, annual: 82 } }; // list prices; Clerk charges
```

- Three gating layers: `<Show when={{ feature: "org:…" }}>` in the UI (decoration);
  `has({ feature: "org:…" })` in routes/actions (`403 upgrade_required`); Convex mutations
  enforcing `PLAN_LIMITS` (`plan_limit` on the 4th workflow on Free, `run_limit` past the monthly
  runs) plus `runNode` refusing nodes whose `requiresFeature` the execution's snapshotted plan
  lacks. Pro-gated: Slack, Notion, Airtable, Linear (`pro_connectors`), AI Agent (`ai_agent`),
  Builder (`ai_builder`), per-minute schedules (`schedules`), 30-day history.
- Session-less callers (webhooks, forms, ticks) get the plan from
  `clerkClient().billing.getOrganizationBillingSubscription(orgId)` (`active` item, else
  `past_due`, else `free_org`), cached 60 s in-process; never throws (falls back to `free_org`).
- **Custom pricing on Clerk's components** (`components/billing/PlanCards.tsx`, shared by
  `/pricing` and `/settings/billing`): `usePlans({ for: "organization" })` (loads signed-out
  too) matched to `PLAN_ORDER` by slug — never hardcode `cplan_…` ids;
  `useSubscription({ for: "organization" })` for the current plan; a pure `planCta` helper picks
  the CTA: signed out → `/sign-up`; no org → `/select-org`; current plan → disabled "Current
  plan" + `SubscriptionDetailsButton` on paid plans; Free while on paid → "Switch to Free" via
  `SubscriptionDetailsButton`; otherwise `<CheckoutButton planId planPeriod for="organization"
  newSubscriptionRedirectUrl onSubscriptionComplete checkoutProps={{ appearance }}>` wrapping our
  own button; annual on a plan without an annual price falls back to `month`. Every Clerk
  billing component sits inside `<Show when="signed-in">` and behind the org check (they throw
  otherwise). A `PlanDetailsButton` "See everything included" link under paid cards. Settings →
  Plans adds a current-plan card (next payment, past-due warning, manage button) and a
  `?upgraded=1` notice. Prices come from Clerk (`fee.amountFormatted`) with `PRICING` as the
  fallback; a monthly/yearly switch drives `planPeriod`.

## 14. eve agents (0.49 constraints apply)

Constraints: flat agent layout (`agent.ts`, `instructions.md`, `tools/`, `channels/eve.ts`
directly in the directory named in `withEve`, no `package.json`); every agent has
`channels/eve.ts` with `eveChannel({ auth: [...] })`; `SessionAuthContext.attributes` values must
be strings or string arrays; durable tools (`ask()`, `sleep`, `createHook`) are static files under
`tools/`, never returned from `defineDynamic`; `ask(ctx, req)` returns a thenable —
`Promise.race([ask, sleep("24h")])` where the sleep branch resolves to `undefined`;
`defineDynamic` model handlers on `session.started` return model-ID strings and a live AI SDK
model built from the org's key may only be returned from `step.started`; disable the default
`bash` / `read_file` / `write_file` / `web_fetch` / `agent` tools with `disableTool()`;
`defineDynamic` closures may capture only JSON-serialisable values; `reset()` is the only call
that ends a session, so end sessions on finish and set `limits.sessionTimeoutMs`; `resume`
follows an idle stream until a timeout, so chat panels load the stored transcript first; eve
services on Vercel share the project's env vars but never see `NEXT_PUBLIC_CONVEX_URL`.

**Runtime agent** (`agents/runtime`, behind the AI Agent node): `limits.sessionTimeoutMs`
5 min; model = house model string (via Vercel AI Gateway, `AI_GATEWAY_API_KEY` locally, OIDC on
Vercel) at `session.started`, replaced at `step.started` by `providerFor(provider, key,
{ workspaceId })(modelId)` from the org's AI connection when the node has one; tools built per
session by `defineDynamic` from the org's connections (one JSON-serialisable closure per
connection, e.g. `telegram_send`, `airtable_create_record`, keyed by bare tool name); channel
auth `[clerkAuth(), engineAuth() (jwtHmac over a 5-minute HS256 token signed with ENGINE_SECRET,
claims orgId/plan/executionId/modelConnectionId/modelId landing in
ctx.session.auth.current.attributes), localDev()]`. The node mints that token, creates a session
with `client.sessions.create({ message: goal, clientContext, outputSchema? })`, awaits
`response.result()`, records every tool call as a child step, and resets the session. The client
uses `redirect: "manual"`.

**Builder agent** (`agents/builder`, Pro, `sessionTimeoutMs` 2 h): channel auth
`[clerkAuth(), localDev()]`; `POST /api/builder/session` gates with
`has({ feature: "org:ai_builder" })` and stores `builderSessions`; every tool re-checks the plan
in Convex inside `execute`; 17 tools: `list_node_types`, `list_connections`, `add_node`,
`connect_nodes`, `configure_node`, `update_node`, `remove_node` (approval required),
`rename_workflow`, `set_trigger_sample`, `list_picker_options`, `get_workflow`, `list_runs`,
`get_run`, `run_workflow` (via `POST /api/engine/run`), `validate_workflow`, `request_connection`
(the one durable tool: `"use workflow"` first statement, `ask()` with a confirmation display and
the usable existing connections as options, raced with `sleep("24h")`, then the chosen
connection id verified for org ownership in a step — the secret never passes through the agent),
`finish` (validates and publishes through `POST /api/engine/publish`, then resets the session).
Edits are Convex mutations with `source: "builder"` so the canvas updates live. The chat panel
(`useEveAgent` from `eve/react`, Clerk bearer auth, workflow id header) renders markdown, auto-
scrolls, shows pending `request_connection` asks as a credential widget that saves through
`POST /api/connections` and answers with the connection id, resumes sessions snapshot-first, and
offers page-aware suggestions when empty.

## 15. UI/UX specification

**Shared** (`components/shared`): `RunStatusPill` / `RunStatusDot` (queued zinc, running amber
pulsing, waiting sky, completed emerald, failed red, cancelled zinc), `WorkflowStatusPill`
(Draft zinc, Published emerald, Paused amber), `TriggerChip` (Manual Play, Form ClipboardList,
Webhook, Schedule CalendarClock, Telegram Send, Stripe CreditCard; accepts `"form"` or
`"form.trigger"`). App header: wordmark, nav (Workflows, Runs, Connections, Settings; longest-
prefix active), theme toggle (Light/Dark/System dropdown, `next-themes`, hydration-safe),
`OrganizationSwitcher hidePersonal`, `UserButton`; below `sm` a hamburger opens a Sheet with the
links and the toggle.

**Workflow list** (`/w`): title + subtitle; toolbar with search, a segmented status filter with
counts (All / Published / Draft / Paused), total, `Browse templates` and primary `New workflow`;
rows (table ≥ md, cards below) showing name → canvas, trigger chip (+ "Next run in …" for
schedules), status pill, last run (dot + relative time + duration, linking to the run history),
an activity strip of the last 8 runs with "n runs · 7d", updated, and a kebab (Open, View runs,
Rename, Delete). Empty state: hero with "Start from a template" / "Start blank" and the template
gallery inline. Compact getting-started card (three steps, dismissable via localStorage).
**Template gallery** dialog: search, category chips with counts, 1–3 column cards with category
eyebrow, name, description, a flow strip of up to six node chips with arrows following the main
path, "Needs …" setup chips, a Pro/feature badge, `Use template`. New-workflow dialog has Blank
and From-template tabs and an upgrade card on `plan_limit`.

**Canvas editor** (`/w/<id>`): one 48px toolbar — back, name (inline rename), status pill,
version, trigger chip; Undo / Redo (⌘Z / ⇧⌘Z), **Tidy up** (auto-layout: longest-path columns
from the trigger, children ordered by parent then handle order so `true` sits above `false`,
collision-resolved rows, one undoable move + `fitView`), Save (⌘S) with "Saved · 2m ago" /
"Unsaved changes", Run (⌘↵; Form workflows open the form dialog; Manual sample JSON in a
popover), Publish/Unpublish, Build with AI, last-run pill, run history. Three columns: palette
(`w-72`, collapsible, remembered in localStorage, collapsed by default under 1100px; search with
`/`; category sections; cards with tinted icon tile, name, description; greyed "Connect" cards
linking to Connections for nodes whose credential is missing; Pro badges; drag **and** click to
add), React Flow canvas (dotted background, themed Controls/MiniMap, edges with handle labels,
edges animate amber while a run passes and settle to primary/red, untaken branches dim, empty-
canvas overlay offering a template or the Builder), config panel (`w-[360px]`; header with icon
tile, label, mono type, trigger chip; "How this node works" guide; the generated form; a
**Last run** section with input/output previews and warnings; Delete node footer; overlay
between 768–899px). Node cards: 240px, tinted icon tile per category (trigger violet, logic
amber, ai sky, chat emerald, data pink, action zinc), label, one-line config summary (`GET
https://…`, `Every 5 min`, `{{ x }} equals urgent`, `3 cases`, model id, `to` address…),
status ring, resizable with persisted size, labelled handles, and a **setup badge** when the
node still needs configuring — dashed amber border plus `Connect` / `Reconnect` / `Needs setup`
/ `Upgrade`, computed from the definition, the inputs (placeholders are not holes) and the org's
connections (blank, deleted, `needs_reconnect`) with the problems in a tooltip; clicking opens
the panel. Runs drawer under the canvas: run picker, legend, a Gantt of every step on a shared
time axis (nested rows for loop passes and agent tool calls), resizable, "All runs" link. Leave
guard on unsaved changes (Save and leave / Discard / Cancel). Builder panel beside the canvas.
Keyboard shortcuts listed in a popover: ⌘S, ⌘Z, ⇧⌘Z, ⌘↵, `/`, Esc, Delete.

**Runs pages** (`/runs`, `/w/<id>/runs`): stats strip (runs loaded with window label, success
rate, failed, average duration, active now), status chips with counts, workflow select (org
page), trigger select, text search over name/error, table (≥ md) / cards (< md) with pill,
workflow link, trigger chip, started (relative + clock), live duration, error; `Load more`
pagination; a full-width/`sm:max-w-3xl` **run detail sheet**: status pill, workflow, trigger,
plan chip, started, duration, copyable run id, Open canvas / All runs, a step timeline built from
the same Gantt logic, then each step with status ring, label, mono key, attempt, duration,
one-line preview, expandable Input / Output / Warnings / Error JSON panels with copy, and the
resume URL for waiting steps.

**Connections** (`/connections`): list (table / cards) with provider icon, label, key hint,
status, inbound URL where relevant, actions (re-test, delete); Add-connection dialog: provider
grid with Pro badges, per-provider form generated from `fields` with help text, the Slack
manifest block, a Pro wall for gated providers, `Test & save`.

**Settings** (`/settings`): plan card (limits, features, Manage plan) and usage card (runs this
month, workflows) from `usage`. **Settings → Plans** as in section 13.

**Marketing**: landing (eyebrow, display headline "Automate your work with a canvas, not a
codebase.", CTAs, an animated canvas mock, "works with" logos, feature sections, footer),
pricing (hero, the shared plan cards, FAQ, CTA), docs page, Clerk auth cards inside a branded
`AuthShell`, `/select-org`. **Public form page**: the Form node's fields, required markers,
submit, "Thanks — we got it.", a draft banner when unpublished.

## 16. Design language and theming

Dark-first product UI that also works in light mode: shadcn tokens only (`bg-background`,
`bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`)
with full `:root` and `.dark` palettes; one accent (`primary`) for the main CTA; the marketing
pages add a teal accent (`--pf-accent*`) and a display font. Geist Sans; Geist Mono for ids, cron,
durations, timestamps, URLs, JSON. `text-2xl font-semibold tracking-tight` page titles, `text-sm`
body, `text-xs text-muted-foreground` meta. Comfortable density, `rounded-lg` controls,
`rounded-xl` cards, `border border-border`, `hover:bg-muted/50`. No gradients, glassmorphism or
emoji in chrome. Every surface has loading skeletons, an empty state (icon, one line, one
action) and an error state; relative times carry an absolute `title`. React Flow follows the
app theme: pass `colorMode` from `next-themes` (never `"system"`, which stamps its own `dark`
class) and paint pane, dots, minimap and controls from CSS variables. Respect
`prefers-reduced-motion` for edge animation.

## 17. Mobile responsiveness (below `md`, 768px; desktop unchanged above)

No horizontal overflow anywhere at 390px or 320px. Tables become stacked cards built from the
same row view-model as the desktop table. Dialogs and sheets go full-screen (Base UI dialog
content is a CSS grid — give the popup a `minmax(0,1fr)` column and `min-w-0` children or a chip
strip widens it via min-content). Chip rows scroll horizontally in their own strip; selects and
inputs stretch full width; all tap targets ≥ 44px; inputs 16px so iOS does not zoom. Canvas: a
two-row toolbar (back · name · status / Run · Publish · overflow menu with Undo, Redo, Tidy up,
Save, Build with AI, Runs), a floating **Add node** button opening the palette as a bottom sheet
with tap-to-add (drag does not work on touch), the config panel and Builder as sheets, the runs
drawer collapsed by default and capped at 45dvh, pinch-zoom on, minimap hidden, 12px handle hit
areas on coarse pointers. Header fits at 320px with the theme toggle inside the menu sheet.
Marketing: hero type scales down, CTAs stack full-width, Clerk cards get phone padding.

## 18. Templates (`lib/templates.ts`, 13; validated by tests against the node schemas)

Each is `{ id, name, category, description, graph: { nodes, edges, triggerId }, requiresFeature? }`
built with `node(id, type, label, column, row, inputs)` (300×150 grid) and `edge(source,
target, handle?)` helpers; credential fields stay blank and are reported by `templateSetup()`
("Needs Telegram"). In gallery order:

1. **Support inbox autopilot** — Webhook `inbox` → Classify (`bug, billing, feature request, question`) → Route by value with `bug` → GitHub issue, `billing` → email a human, `feature request` → Notion page, `default` → LLM reply → email the requester.
2. **Morning tech digest** — cron `0 8 * * 1-5` → HTTP `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5` → For each hit → LLM one-liner; `done` → LLM digest → email.
3. **Stripe payment → welcome sequence** — Stripe `checkout.session.completed` → LLM welcome → email → Airtable ledger row → Pause 259200 s → check-in email.
4. **Blog post with editorial approval** — Form (topic, audience, tone select) → LLM outline → LLM draft → Ask for approval (`Publish` / `Needs work`) → Notion page or email the writer.
5. **Website watchdog with escalation** — every 5 min → HTTP GET → If status ≠ 200 → Telegram alert → Pause 300 s → HTTP again → If still ≠ 200 → escalation email, else "back" Telegram; healthy → Set values.
6. **Telegram AI concierge** — Telegram message → AI Agent (`{{ message.text }}`, 6 steps) → reply in the same chat (`ai_agent`).
7. **Meeting notes → action items** — Form (title, notes) → Extract `items: string[]` → For each → GitHub issue; `done` → summary email with `{{ each_action.count }}`.
8. **Invoice intake with sign-off** — Form (invoice text) → Extract vendor/amount/currency/due_date → If amount > 1000 → approval (`Pay it` / `Hold`) → Airtable or email; else Airtable auto-approved.
9. **Lead intake triage** — Form → Classify urgency → Telegram or email.
10. **Webhook to API call** — Webhook → HTTP → Set values.
11. **Hourly endpoint check** — hourly → HTTP → email.
12. **Approval before action** — Manual → approval → both outcomes into one condition → Set values.
13. **Loop over a list** — Manual → For each → Set values on `each` and `done`.

## 19. Provisioning and environment

Order matters. **CLI** = you run it; **MANUAL** = a dashboard step for me.

1. Pre-flight: empty directory, Node 24, pnpm, `clerk whoami`, `vercel whoami`, `gh auth status`.
2. Scaffold: `pnpm create next-app@16.3.4 . --yes --ts --tailwind --eslint --app --no-src-dir
   --import-alias "@/*" --use-pnpm --disable-git --no-agents-md`, pin every package from
   section 2, `pnpm dlx shadcn@4.20.0 init -d` and add: button input dialog sheet dropdown-menu
   badge tabs tooltip sonner card select textarea label separator scroll-area command popover
   switch table skeleton input-group alert-dialog. `git init -b main`; private GitHub repo.
3. Clerk (CLI): `clerk apps create "PapaFlow" --json` → `clerk link --app <id>` →
   `clerk enable orgs --max-members 5 --yes` → `clerk env pull --file .env.local`; add
   `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`.
4. Convex (CLI): `pnpm convex:dev` once `convex/schema.ts` exists (writes `CONVEX_DEPLOYMENT`,
   `NEXT_PUBLIC_CONVEX_URL`).
5. **MANUAL**: Clerk Dashboard → Convex integration → Activate for the Development instance; then
   `npx convex env set CLERK_FRONTEND_API_URL https://<instance>.clerk.accounts.dev`.
6. Secrets (CLI): `openssl rand -base64 32` → `ENGINE_SECRET` (`.env.local` + `npx convex env
   set ENGINE_SECRET …`) and `CREDENTIALS_KEK` (`.env.local` only);
   `npx convex env set APP_ORIGIN http://localhost:3000`.
7. Billing (CLI): `clerk enable billing --for orgs --yes --no-skills` (creates `free_org`), then
   `clerk config patch --json '<JSON below>' --dry-run` and again with `--yes`; confirm with
   `clerk api /billing/plans`. **MANUAL**: Subscription plans → Plans for Organizations → Team →
   Seat-based.

```json
{"billing":{"features":{"core_connectors":{"name":"Core connectors"},"pro_connectors":{"name":"Pro connectors"},"ai_agent":{"name":"AI agent"},"ai_builder":{"name":"AI builder"},"schedules":{"name":"Schedules"},"run_history_30d":{"name":"30-day run history"},"shared_connections":{"name":"Shared connections"},"audit_log":{"name":"Audit log"},"priority_runs":{"name":"Priority runs"}},"plans":{"free_org":{"features":["core_connectors"]},"pro":{"name":"Pro","payer_type":"org","amount":2900,"annual_monthly_amount":2400,"currency":"usd","free_trial_enabled":true,"free_trial_days":7,"features":["core_connectors","pro_connectors","ai_agent","ai_builder","schedules","run_history_30d"]},"team":{"name":"Team","payer_type":"org","amount":9900,"currency":"usd","features":["core_connectors","pro_connectors","ai_agent","ai_builder","schedules","run_history_30d","shared_connections","audit_log","priority_runs"]}}}}
```

8. Vercel: create the project, connect the GitHub repo (every push to `main` builds Production),
   env on Production (and Preview): `CONVEX_DEPLOY_KEY` (production key on Production, preview
   key on Preview — **MANUAL** to generate in the Convex dashboard), `CONVEX_URL` (the deployment
   URL for the eve services), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `ENGINE_SECRET`, `CREDENTIALS_KEK`, `APP_ORIGIN`, optional `RESEND_API_KEY`;
   `npx convex env set --prod CLERK_FRONTEND_API_URL / ENGINE_SECRET / APP_ORIGIN`. Never set
   `NEXT_PUBLIC_CONVEX_URL` or `CONVEX_DEPLOYMENT` on Vercel; never add `CONVEX_URL` to
   `.env.local`.
9. Optional, local only: `AI_GATEWAY_API_KEY` for the house model (OIDC pays on Vercel).

`.env.example` lists every variable with a comment; every third-party credential is a
connection, never an env var.

## 20. Testing and verification

- vitest: pure helpers (graph walking, templates, validation, plans, key shapes, filters, stats,
  auto-layout, node setup, node summaries, row view-models), route handlers with mocked
  `@/lib/engine-client` (webhook, form, schedule-tick, publish, wait, Slack), connector `test()`
  with a fetch routing table, Convex mutations/queries with `convex-test`, and `renderToStaticMarkup`
  smoke tests of components (no DOM library). Target ≥ 1,500 tests by the end.
- Browser checks: a headless-Chrome screenshot runner (Playwright `channel: "chrome"`) that signs
  in with a Clerk sign-in ticket (`clerk api /sign_in_tokens -X POST -d '{"user_id":…}'`, run
  from the repo root, parse stdout+stderr), sets the active organisation by POSTing
  `active_organization_id` to the Frontend API's session `touch` endpoint, captures 1440×900 and
  390×844 shots, and reports document `scrollWidth − clientWidth` per page (must be 0).
- End-to-end on production: publish → schedule tick → run; form submit → run; Slack no-team →
  400; unknown webhook → 404; engine routes → 401 without the secret; draft form → 409.

## 21. Known gotchas (do not rediscover these)

- Anything reachable from `runGraph` cannot import `node:*` — Telegram's secret uses Web Crypto.
- `clerkMiddleware` must exclude `/.well-known/workflow/` and `/eve/` or runs and agents break.
- `next.config.mts`, not `.ts`, because `eve/next` is ESM-only; `@/` aliases do not resolve
  inside `agents/` under the eve dev server — use relative imports there.
- `defineDynamic` closures that capture non-JSON values silently drop every tool.
- `lib/engine-env.ts` must read `process.env.NEXT_PUBLIC_CONVEX_URL` literally (Next inlines only
  literal reads); a computed `process.env[name]` breaks the fallback.
- `npx convex dev` writes neither Convex URL when `.env.local` names both `CONVEX_URL` and
  `NEXT_PUBLIC_CONVEX_URL`; `CONVEX_ALLOW_ANONYMOUS=false` prevents a silent anonymous deployment.
- The cloud dev Convex deployment cannot reach `localhost`; schedule ticks need a reachable
  `APP_ORIGIN`.
- Pasted keys carry newlines/quotes — normalise. Anthropic Admin keys, Claude Code OAuth tokens
  and identity-linked keys without a workspace all fail with a bare 401/400 unless explained.
- Resend's sandbox only sends from `onboarding@resend.dev` to the account owner.
- Anthropic 5-series models reject sampling parameters; omit them.
- eve sessions never end on their own — `reset()` them and set `sessionTimeoutMs`; `resume`
  hangs on idle streams — snapshot first.
- React Flow's `colorMode="system"` stamps its own `dark` class and breaks light mode; pass the
  resolved theme.
- `buttonVariants({ className: "hidden sm:inline-flex" })` does not hide anything (cva
  concatenates); use `cn()`.
- A Base UI dialog is a CSS grid: a horizontally scrolling strip inside it widens the popup via
  min-content unless the column is `minmax(0,1fr)`.
- Shell pipes hide TypeScript failures — check `npx tsc --noEmit` exit codes directly.
- Vercel router prefetch requests may log 404s in the console after a deploy; navigation is
  unaffected.

## 22. Build order and acceptance checks

1. **Foundation** — Clerk + Convex + schema + canvas that saves graph JSON per org + three nodes
   + workflow list + org switcher. *Check:* two orgs, one workflow each, reload persists, switching
   org changes the list.
2. **Engine** — `runGraph`, `runNode`, step rows, `ENGINE_SECRET`, Run button, HTTP + email
   nodes, live status. *Check:* nodes go amber then green; `pnpm workflow:web` shows one step per
   node; a failing URL turns red; re-running after a crash does not duplicate rows.
3. **Templates, picker, logic** — `{{ }}`, Set / If / Route, untaken branches dim.
4. **Vault, connections, AI nodes** — add your own Anthropic key, model list fills, LLM node
   summarises; Convex shows only ciphertext.
5. **Triggers** — webhook `curl` starts a run; form page; Telegram inbound; Stripe.
6. **Token connectors and action nodes** — Slack (manifest), Discord, Telegram, Teams, Notion,
   Airtable, Linear, GitHub, Resend, pickers.
7. **OAuth** (optional path, hidden without client ids).
8. **Control nodes** — Pause, Ask for approval (buttons in Slack/Discord/Telegram resume the run),
   Wait for a callback, For each.
9. **Schedules** — publish arms; a 2-minute schedule fires twice; unpublish disarms.
10. **Runtime agent** — spike `withEve` + a durable `ask()` tool first; Agent node uses tools
    built from the org's connections; tool calls appear as nested steps.
11. **Billing** — plans patched, three-layer gating, upgrade on the test gateway flips the
    `pla` claim within a minute, custom pricing cards on `CheckoutButton`.
12. **Builder agent** — the panel draws nodes one by one, parks on `request_connection`, the
    widget saves the token, `finish` validates and publishes.
13. **Marketing, auth, pricing, polish, templates, mobile** — everything in sections 15–18.
14. **Production deploy** — Vercel + Convex production, env matrix, eve health endpoints
    (`/eve/agents/{runtime,builder}/eve/v1/health`) answer, a README that explains the whole thing.

## 23. Deliverables

- The running app on Vercel with a Convex production deployment.
- `README.md` in the style of a flagship educational repo: badges, sponsor links (Clerk first),
  "what is this", features with screenshots, a beginner-friendly explainer of how a run works
  (node contract, variables, durable execution, publish and triggers, Convex as the alarm clock,
  the vault, tenancy and billing, the two agents, custom pricing), mermaid architecture diagrams,
  step-by-step setup with the exact commands above, a demo script, common issues, and a quick
  reference. Screenshots captured from the deployed app into `docs/assets/`.
- `CLAUDE.md` with the stack, layout, hard rules and env matrix; `docs/PLAN.md`;
  `docs/PROVISIONING.md` recording what was provisioned and every dashboard-only step.
- `.env.example`, `vitest` green, `tsc` and `eslint` clean.
