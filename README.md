# PapaFlow

n8n-style workflow automation SaaS. Teams (Clerk organisations) bring their own AI keys and connect chat/app services as **connections** inside the product, draw workflows on a React Flow canvas (or describe them to a Builder agent), and every run executes durably on Vercel Workflows.

Stack: Next.js 16 · Convex · Clerk (Organizations + Billing) · Workflow SDK 5 · eve · AI SDK 7 · React Flow · shadcn/ui (Base UI).

## Setup

```bash
pnpm install
clerk env pull --file .env.local          # Clerk dev keys (app is linked: `clerk whoami`)
CONVEX_ALLOW_ANONYMOUS=false npx convex dev # first run creates/links the Convex dev deployment and writes CONVEX_* vars
cp .env.example .env.example.check         # compare variable names with .env.local
```

`.env.example` lists every variable. `ENGINE_SECRET` must also be set on Convex (`npx convex env set ENGINE_SECRET …`) and `CLERK_FRONTEND_API_URL` points Convex at the Clerk Frontend API. See `docs/PROVISIONING.md` for what exists and the dashboard-only steps.

## Commands

```bash
pnpm dev            # Next.js (Turbopack) — also boots the Workflow Local World and the eve dev server once those phases land
pnpm convex:dev     # Convex dev push/watch
pnpm typecheck      # tsc --noEmit
pnpm lint
pnpm test           # vitest: `unit` (node) + `convex` (edge-runtime, convex-test)
pnpm workflow:web   # local workflow run inspector (Phase 2+)
```

## Runtime agent

The **AI Agent** node (`ai.agent`) does not call a model itself. It opens a session on the eve agent
in `agents/runtime/`, which `next.config.mts` mounts at `/eve/agents/runtime/eve/v1/*`:

```bash
curl http://localhost:3000/eve/agents/runtime/eve/v1/health
# {"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}
```

`pnpm dev` starts the eve dev server itself — no second terminal. Health is public; every session
route runs the auth walk in `agents/runtime/channels/eve.ts`: a Clerk session token (a person, from
the browser), then the engine's own five-minute HS256 token signed with `ENGINE_SECRET`
(`lib/eve.ts#mintEngineToken`), then `localDev()`. That last entry is why an unauthenticated
`POST …/eve/v1/session` is accepted under `pnpm dev` and a `401` in production.

**Which model an Agent node uses.** The node's connection and model dropdowns pick one of the org's
AI connections, and those two ids travel to the agent as JWT claims. `agents/runtime/agent.ts`
resolves the model twice: `session.started` returns the house model id (`openai/gpt-5.6-luna`,
through the Vercel AI Gateway), and `step.started` decrypts the org's key and returns a live AI SDK
model built from it. Step scope wins, so a run uses the organisation's own key and falls back to the
house model only when the connection is missing, revoked or unreadable. Locally the house model
needs `AI_GATEWAY_API_KEY`; on Vercel the deployment's OIDC token pays for it.

**Which tools it gets.** `agents/runtime/tools/connectors.ts` resolves them once per session from the
org's active connections: `slack_post`, `discord_post`, `telegram_send`, `notion_create_page` when
the workspace has that connection and its plan covers it, plus `http_request` always. Each tool calls
the same node `run()` the canvas uses, opening the credential inside the call. The default `bash`,
`read_file`, `write_file`, `web_fetch` and `agent` tools are disabled.

Tool calls appear in the run drawer as rows nested under the Agent node's own step.

## Builder agent

Pro organisations get a **Build with AI** button in the canvas run bar. It opens a chat beside the
canvas whose tool calls edit the workflow document directly, so the graph draws itself while the
agent talks. The agent lives in `agents/builder/` and `next.config.mts` mounts it at
`/eve/agents/builder/eve/v1/*`:

```bash
curl http://localhost:3000/eve/agents/builder/eve/v1/health
# {"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}
```

**Who may open one.** `POST /api/builder/session` checks `has({ feature: "org:ai_builder" })`,
proves the workflow belongs to the caller's organisation and writes the `builderSessions` row before
any chat exists; the panel then opens the eve session itself with `useEveAgent({ agent: "builder" })`.
Every request carries the user's Clerk token as a bearer and the workflow id as an
`x-papaflow-workflow` header — `agents/builder/channels/eve.ts` verifies both and projects
`orgId`, `userId`, `plan` and `workflowId` into `ctx.session.auth.current.attributes`, which is where
every tool reads them from. (eve's `clientContext` reaches the model, not the tools, so it cannot
carry the workflow id; see `lib/builder-protocol.ts`.) Each tool then re-reads the plan from Clerk
before it does anything — three layers, and only the last two are enforcement.

**Its tools.** `list_node_types` and `list_connections` to look around; `add_node`, `connect_nodes`,
`configure_node` and `remove_node` to edit (each one a Convex mutation in `convex/builder.ts` that
bumps `version` with `lastEditSource: "builder"`); `validate_workflow` (`lib/validate-workflow.ts`)
and `finish` to land it. `remove_node` carries `approval: always()`, so deleting a node asks the user
first. The default `bash`, `read_file`, `write_file`, `web_fetch` and `agent` tools are disabled.

**Credentials.** `request_connection` is a durable tool: `"use workflow"`, `ask()` raced against a
24-hour `sleep`, and the turn parks with nothing running until the user answers. The panel renders
the ask as a credential widget (matched on `part.toolName === "request_connection"`), the pasted key
goes to `POST /api/connections` — never through the chat — and the widget answers with the new
connection's id alone.

**Live canvas.** Nothing in the panel writes to Convex. The agent's mutations arrive on the
`workflows.get` subscription the editor already holds, and `components/canvas/Canvas.tsx` adopts a
newer document stamped `lastEditSource: "builder"` even when a local save is pending, cancelling that
save rather than raising a version conflict.

## Deploying

Every push to `main` builds Production on Vercel (project `papaflow`, team `sonnysanghas-projects`): the build command in `vercel.ts` runs `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`, which pushes the Convex functions to the production deployment, compiles the Workflow SDK functions (`runGraph`, `scheduler`) and builds both eve services (`/eve/agents/runtime`, `/eve/agents/builder`). Live at https://papaflow.vercel.app.

Vercel env (Production): `CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `ENGINE_SECRET`, `CREDENTIALS_KEK`, `APP_ORIGIN`. Convex production env: `CLERK_FRONTEND_API_URL`, `ENGINE_SECRET`. Never set `NEXT_PUBLIC_CONVEX_URL` or `CONVEX_DEPLOYMENT` on Vercel.

## Stop points (things only you can do)

- **Your own AI key** — add an OpenAI / Anthropic / Gemini / Groq connection on the Connections page; the LLM, Extract, Classify, AI Agent and Builder features need it (or `AI_GATEWAY_API_KEY` locally for the house model).
- **Chat credentials** for a live Approval check — a Telegram bot token is the quickest; Slack needs its signing secret and the interactivity URL shown on the connection; Discord needs the public key and the interactions URL.
- **Preview deployments** — generate a *preview* Convex deploy key in the Convex dashboard and add it as `CONVEX_DEPLOY_KEY` scoped to Preview, plus `APP_ORIGIN` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` on Preview.
- **Team plan seats** — Clerk dashboard → Subscription plans → Plans for Organizations → Team → Seat-based.
- **Going to a real domain** — `clerk deploy` (owned domain + DNS + your Stripe account), then repeat the Convex integration for the production Clerk instance.

Details and the full provisioning log: `docs/PROVISIONING.md`.

## Docs

- `CLAUDE.md` — rules, layout, phases (corrected against installed versions on 2026-09-02)
- `docs/PLAN.md` — the full plan with research and code sketches
- `docs/PROVISIONING.md` — created resources and remaining dashboard steps
- `docs/research/` — verified API/version research digests used by every phase
- `docs/superpowers/plans/` — per-phase implementation plans
