# Provisioning status (Phase 0) — 2026-09-02

## Created by CLI

| Resource | Value |
|---|---|
| Repo | https://github.com/sonnysangha/papaflow (private, `main`) |
| Clerk app | **PapaFlow** `app_3ImGFtOGHgLVV1SJa6VTqFeNBJ4`, dev instance `ins_3ImGFp6EL9RZZvowE5Yj2MZAXYf`, Frontend API `https://curious-cat-3256.clerk.accounts.dev`, Organizations enabled (unlimited members; `force_organization_selection` set to **false** on 2026-09-02 — the app handles org selection at `/select-org` because Clerk's forced choose-organization task did not complete reliably under automation) |
| Convex project | `papaflow` on team `sonny-sangha` — dev `fastidious-puffin-373` (`https://fastidious-puffin-373.convex.cloud`, HTTP actions at `https://fastidious-puffin-373.convex.site`), prod `content-albatross-126` |
| Convex env (dev + prod) | `CLERK_FRONTEND_API_URL`, `ENGINE_SECRET` |
| Vercel project | `papaflow` on `sonnysanghas-projects` (`prj_SP3inlGaaKH8SPSgO9z5HMmYcq4x`), GitHub connected, `vercel.ts` build command |
| Vercel env | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ENGINE_SECRET`, `CREDENTIALS_KEK`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` (prod/preview/dev); `APP_ORIGIN` (prod = https://papaflow.vercel.app, dev = http://localhost:3000); `CONVEX_DEPLOY_KEY` (production key); `CONVEX_URL` (Production = https://content-albatross-126.convex.cloud — the URL the eve services read, because `NEXT_PUBLIC_CONVEX_URL` only exists inside the Next build) |
| Local | `.env.local` holds the Clerk dev keys, Convex dev deployment, `ENGINE_SECRET`, `CREDENTIALS_KEK`, `APP_ORIGIN`, `VERCEL_OIDC_TOKEN` |

## Dashboard steps still needed (only you can do these)

1. ✅ DONE (2026-09-02) **Clerk ↔ Convex integration** — https://dashboard.clerk.com/apps/setup/convex → select **PapaFlow** (Development) → **Activate Convex integration**. The Frontend API URL shown must be `https://curious-cat-3256.clerk.accounts.dev` (already set on both Convex deployments).
2. **Convex preview deploy key (optional; only for PR preview deployments)** — https://dashboard.convex.dev/t/sonny-sangha/papaflow → Project Settings → **Generate Preview Deploy Key** → `vercel env add CONVEX_DEPLOY_KEY preview --value 'preview:…' --yes`.
3. **Platform email fallback (optional)** — create a key at https://resend.com/api-keys and add `RESEND_API_KEY=` to `.env.local` (+ `vercel env add RESEND_API_KEY production --value … --yes`). Before a domain is verified Resend only delivers to the account's own email from `onboarding@resend.dev`.

Clerk is the source of truth for organisations, memberships and billing: no Clerk webhook, no mirror tables.

Everything else (AI keys, Slack/Discord/Telegram/Notion/Airtable/Linear/GitHub/Stripe credentials) is entered by users as **connections** inside the app — no operator setup.

## Verified session-token shape (2026-09-02, QA user in Org A)

Decoded in the app after the Clerk Convex integration was activated and `clerk config patch` added the custom claims:

```json
{ "aud": "convex", "v": 2, "sts": "active",
  "o": { "id": "org_…", "rol": "admin", "slg": "org-a-…" },
  "org_id": "org_…", "org_role": "org:admin" }
```

- `{{org.id}}` / `{{org.role}}` shortcodes DO resolve (research had marked this unverified). `org_role` is the prefixed form (`org:admin`), `o.rol` the bare form (`admin`).
- `pla` / `fea` are absent until Clerk Billing is enabled in Phase 11 → `requireOrg()` falls back to `free_org`.
- QA fixture: user `qa+clerk_test@example.com` (`user_3ImKEBIo4EWm1INJJWXKaL6BhOq`, no password; signed in via `clerk impersonate … --print` tickets on `http://localhost:3000/sign-in?__clerk_ticket=…`). Delete it with `clerk api /users/user_3ImKEBIo4EWm1INJJWXKaL6BhOq -X DELETE --yes` when no longer needed.

## Live-check stop points (you supply these inside the app; nothing goes into env files)

- **AI key (Phase 4 check)** — Connections → Add connection → e.g. Anthropic → paste your own key → "Test & save". The model list fills from the provider; the LLM/Extract/Classify nodes then run.
- **Telegram bot (Phase 5 check)** — create a bot with @BotFather, then Connections → Telegram → paste the token. PapaFlow registers the webhook automatically when `APP_ORIGIN` is https (on localhost it stores the inbound URL and skips `setWebhook`; use the Vercel preview URL or a tunnel for inbound tests).
- **Stripe (Phase 5 check)** — run `stripe login` in a terminal (the CLI's saved test key has expired), then `stripe listen --forward-to localhost:3000/api/events/stripe/<connectionId>` prints a `whsec_…`; paste it into Connections → Stripe. `stripe trigger payment_intent.succeeded` then starts a run.

### Phase 8 live check (Approval buttons) — needs the user's own chat app
- **Telegram (cheapest):** create a bot with @BotFather, add it as a Telegram connection (Connections → Add connection → Telegram). Nothing else to configure: the connection's `afterCreate` registered the webhook with `callback_query` updates. Drop an Approval node, pick the bot and a chat (message the bot once so the chat id is learned), run, press Approve on the phone.
- **Slack:** create the app from the manifest in the Add-connection dialog — it already sets Interactivity & Shortcuts → Request URL to `<APP_ORIGIN>/api/events/slack`, one URL for every connection (presses are matched to a connection by the workspace id Slack sends, indexed as `connections.externalId`). The connection then needs the app's *Signing Secret* (Basic Information) in the optional field, or the route answers `no_signing_secret`. The bot needs `chat:write` and must be in the channel. The old per-connection URL (`/api/events/slack/<connectionId>`) still works for apps already pointed at it.
- **Discord:** the bot connection stores the app's *Public Key* (General Information); set Interactions Endpoint URL to `/api/events/discord/<connectionId>` from the connection row. Discord's save-time PING and bad-signature probes are answered by the route.
- Local checks need a public origin (Vercel preview URL or a tunnel); the routes are verified without credentials by `tests/approval-routes.test.ts` and the signed-curl recipe in `docs/superpowers/plans/2026-09-02-phase-08-control.md`.

## Billing (done 2026-09-03 via CLI)
- `clerk enable billing --for orgs --yes --no-skills` → `billing.organization_enabled: true`; Clerk auto-created the default org plan `free_org` ("Free").
- `clerk config patch --json '<features + plans>' --yes` (JSON in `docs/research/clerk.md` → COMMANDS) created features `core_connectors, pro_connectors, ai_agent, ai_builder, schedules, run_history_30d, shared_connections, audit_log, priority_runs` and plans `pro` ($29/mo, $24 annual-monthly, 7-day trial) and `team` ($99/mo). `clerk api /billing/plans` confirms the slugs and feature lists. Note: patching plans before billing is enabled fails with `missing_name` because `free_org` does not exist yet — enable first.
- Dev checkout runs on Clerk's shared test gateway; no Stripe account is needed until `clerk deploy`.
- **Dashboard-only stop point:** Subscription plans → Plans for Organizations → Team → *Seat-based* (custom limit / cost per seat / included seats). No config-schema key exists for seats.

## Production status (2026-09-03)
- Every push to `main` builds Production on Vercel (Git integration): `npx convex deploy --cmd 'pnpm build'` pushes functions to the production Convex deployment `content-albatross-126`, the build compiles the workflows (26 steps, 2 workflows) and both eve services (`eve-runtime`, `eve-builder`); `https://papaflow.vercel.app` serves the marketing pages, auth pages and both agents' `/eve/v1/health`.
- **Dashboard tidy-up (optional):** the production Convex deployment still lists empty tables `organizations`, `memberships`, `orgPlans` from the Phase 1 schema before Clerk became the source of truth. Convex never drops removed tables; delete them from the Convex dashboard → Data → table → Delete table.
- Preview deployments still need the **Preview** Convex deploy key (`CONVEX_DEPLOY_KEY` scoped to Preview; Convex dashboard → Project settings → Generate preview deploy key) plus `APP_ORIGIN` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` on Preview.
- **`CONVEX_URL` on Preview is per branch.** The eve services (`/eve/agents/runtime`, `/eve/agents/builder`) are separate Vercel services: they see the project's environment variables but not `NEXT_PUBLIC_CONVEX_URL`, which `convex deploy --cmd-url-env-var-name` only injects into the Next build process (Next then inlines it into the Next bundle). Production carries a plain `CONVEX_URL=https://content-albatross-126.convex.cloud`; a preview key spins up **one Convex deployment per branch**, so a preview whose agents must work needs `CONVEX_URL` set to that branch's deployment URL — either a Preview-scoped variable limited to the branch (`vercel env add CONVEX_URL preview <branch>`) or the branch's URL copied from the Convex dashboard after its first preview build. Without it the Builder's tools answer `{ ok: false, error: "service_unavailable" }` and the Runtime agent fails an Agent-node step (an interactive chat degrades to `http_request` instead), both with the missing variable named in the function log (`lib/engine-env.ts`). The Next runtime itself — runs, triggers, schedules — is unaffected: it keeps the URL Next inlined into the build. Set `CONVEX_URL` on Vercel only; adding it to a local `.env.local` stops `npx convex dev` updating the Convex URL there at all.
