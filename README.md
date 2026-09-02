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

## Docs

- `CLAUDE.md` — rules, layout, phases (corrected against installed versions on 2026-09-02)
- `docs/PLAN.md` — the full plan with research and code sketches
- `docs/PROVISIONING.md` — created resources and remaining dashboard steps
- `docs/research/` — verified API/version research digests used by every phase
- `docs/superpowers/plans/` — per-phase implementation plans
