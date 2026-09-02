# Phase 11 — Billing Implementation Plan (Clerk Billing for B2B, Clerk as source of truth)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one Opus subagent per task. Convex limits are tested with convex-test.

**Goal:** Clerk plans + features gate the product in three layers; usage counters and upgrade walls; no mirror tables (user decision): the session token's `pla`/`fea` claims drive Convex and the UI, the engine asks Clerk's Backend API at run start.

**Verified facts (docs/research/clerk.md):** `clerk enable billing --for orgs --yes --no-skills` enables org billing and auto-creates the default org plan slug `free_org`; plans/features are config-as-code: `clerk config patch --json '{"billing":{"features":{…},"plans":{…}}}' --dry-run` then `--yes` (exact JSON in docs/research/clerk.md COMMANDS); seat-based Team settings are dashboard-only; dev uses Clerk's shared test gateway (no Stripe account); `<PricingTable for="organization" />` from `@clerk/nextjs`; `useSubscription({ for: "organization" })` from `@clerk/nextjs/experimental` (display only); `has({ feature: "org:<slug>" })` / `has({ plan: "org:<slug>" })` server-side from `await auth()` and client-side from `useAuth()`; `<Show when={{ feature: "org:pro_connectors" }} fallback>`; `clerkClient().billing.getOrganizationBillingSubscription(orgId)` (public beta) → `subscriptionItems[].{ status, plan.slug, periodEnd, isFreeTrial }`; feature claims refresh with the session token (60 s lifetime).

## Provisioning (CLI, first thing in the phase)
```bash
clerk enable billing --for orgs --yes --no-skills
clerk config patch --json '<features+plans JSON from docs/research/clerk.md>' --dry-run   # then --yes
clerk api /billing/plans          # confirm free_org / pro / team
```
MANUAL (user): Dashboard → Subscription plans → Plans for Organizations → Team → Seat-based.

## Tasks
- [ ] Task 1: `lib/billing.ts` (Phase 5 already has `getOrgPlan`) — extend with `getOrgEntitlements(orgId)` → `{ slug, features, limits }` (60 s cache) used by every session-less path (triggers, Builder session route, eve auth channel attributes). Tests with a mocked `clerkClient`.
- [ ] Task 2: gating — `<Show when={{ feature: "org:pro_connectors" }} fallback={<UpgradeCard feature="pro_connectors" />}>` around Pro node cards in `NodeSidebar` and Pro connectors in `ProviderPicker`; `requiresFeature` set on the Pro connectors/nodes (`slack`, `notion`, `airtable`, `linear` → `pro_connectors`; `ai.agent` → `ai_agent`; schedules faster than hourly → `schedules`); `has()` checks in `/api/connections` (already), `/api/builder/session`, `/api/schedules`; Convex: `workflows.create` (already), `executions.create` (already, via `planSlug`), `schedules.upsertForWorkflow` (min interval); `runNode` refuses nodes/connections whose `requiresFeature` is missing from `featuresForPlan(execution.planSlug)` (already wired in Phase 4 — verify with a test).
- [ ] Task 3: settings + billing pages — `app/(app)/settings/page.tsx` (plan badge from `api.plan.current`, `UsageBar` from `api.usage.current` (runs this month vs limit; workflows count vs limit), members note), `app/(app)/settings/billing/page.tsx` with `<PricingTable for="organization" highlightedPlan="pro" newSubscriptionRedirectUrl="/settings/billing" />` and a `useSubscription` summary; `UpgradeCard` links to `/settings/billing`; the workflow-list `plan_limit` toast becomes the upgrade card.
- [ ] Task 4: token refresh UX — after checkout, the `pla`/`fea` claims arrive with the next session token (≤ 60 s); call `useAuth().getToken({ skipCache: true })` and `router.refresh()` on the billing page's return, and show "Activating your plan…" until `api.plan.current` reports the new slug.
- [ ] Phase check: on `free_org` the fourth workflow shows the upgrade card; upgrade to Pro on the test gateway; within a minute the claims flip and the wall disappears; downgrade → a Pro node refused at run time with "Upgrade required: pro_connectors" on the step row.
