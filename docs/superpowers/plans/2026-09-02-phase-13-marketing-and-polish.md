# Phase 13 — Marketing Pages, Auth Pages, Pricing and UX Polish

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one Opus subagent per task. Load `frontend-design:frontend-design` before any visual work and follow its direction (distinctive, intentional; no templated defaults). Design tokens stay on shadcn (Base UI) with Geist; dark-first product UI, light-friendly marketing.

**Goal (user):** "effectively a full n8n clone with a beautiful UX/UI, landing page, sign in/up page, pricing page etc. It should be easy to use and simple to follow."

## Scope
1. **Landing page** (`app/(marketing)/page.tsx`, public): hero with the one-sentence pitch and a live-looking canvas illustration (real React Flow, read-only, animated status rings), "How it works" (draw → connect → run durably), connector wall (logos as lucide/simple-icons-free text badges), "Bring your own keys" trust section (AES-256-GCM, per-org isolation), pricing teaser, footer. Signed-in visitors are redirected to `/w`.
2. **Pricing page** (`app/(marketing)/pricing/page.tsx`, public): three plan cards (Free / Pro / Team) generated from `lib/plans.ts` (limits + feature slugs → human labels), monthly/annual toggle, FAQ; CTA → `/sign-up`; signed-in → `/settings/billing` (Clerk `<PricingTable for="organization" />`).
3. **Auth pages**: `<SignIn />`/`<SignUp />` inside a split layout (left: brand + three benefit lines; right: Clerk card) with `appearance` tuned to the tokens; `/select-org` styled the same way.
4. **App polish**: consistent page headers (title, description, primary action), empty states with a one-line "what to do next", loading skeletons everywhere a query can be undefined, toast copy in plain language, keyboard shortcuts on the canvas (Delete, Cmd+S no-op hint, Cmd+K opens the node search), node sidebar search that also matches descriptions, minimap toggle, zoom-to-fit on load, unsaved/conflict indicator, run bar with a "Last run" link, runs page filters (status), connections page grouped by category with logos, settings page with usage bars.
5. **Onboarding**: first visit to `/w` with no workflows shows a 3-step checklist (add a connection → create a workflow → run it) that ticks off from real data; a "Start from a template" dialog with 3 templates (Contact form → Extract → Slack; Webhook → Condition → Email; Schedule → HTTP → Discord) that create a pre-wired workflow.
6. **Accessibility & responsiveness**: focus rings, labels, contrast checked; marketing pages responsive to 360 px; app pages usable at 1024 px+.

## Tasks
- [ ] Task 1: marketing layout + landing (frontend-design skill; no Clerk components above the fold; `next/font` Geist; `next/image` for any raster).
- [ ] Task 2: pricing page + plan copy helpers (`lib/plans.ts#PLAN_COPY`) + FAQ.
- [ ] Task 3: auth pages layout + Clerk `appearance` + select-org.
- [ ] Task 4: app polish pass (headers, empty states, skeletons, shortcuts, sidebar search, runs filters, connections grouping).
- [ ] Task 5: onboarding checklist + templates dialog (creates workflows via `api.workflows.create` + `saveGraph`).
- [ ] Phase check: Lighthouse ≥ 90 on landing/pricing (performance, a11y, best practices); a new user can go from landing → sign up → first run in under 3 minutes following only on-screen hints.
