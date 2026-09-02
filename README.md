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

## Docs

- `CLAUDE.md` — rules, layout, phases (corrected against installed versions on 2026-09-02)
- `docs/PLAN.md` — the full plan with research and code sketches
- `docs/PROVISIONING.md` — created resources and remaining dashboard steps
- `docs/research/` — verified API/version research digests used by every phase
- `docs/superpowers/plans/` — per-phase implementation plans
