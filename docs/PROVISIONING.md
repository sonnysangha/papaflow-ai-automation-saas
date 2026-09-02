# Provisioning status (Phase 0) — 2026-09-02

## Created by CLI

| Resource | Value |
|---|---|
| Repo | https://github.com/sonnysangha/papaflow (private, `main`) |
| Clerk app | **PapaFlow** `app_3ImGFtOGHgLVV1SJa6VTqFeNBJ4`, dev instance `ins_3ImGFp6EL9RZZvowE5Yj2MZAXYf`, Frontend API `https://curious-cat-3256.clerk.accounts.dev`, Organizations enabled (forced selection, unlimited members) |
| Convex project | `papaflow` on team `sonny-sangha` — dev `fastidious-puffin-373` (`https://fastidious-puffin-373.convex.cloud`, HTTP actions at `https://fastidious-puffin-373.convex.site`), prod `content-albatross-126` |
| Convex env (dev + prod) | `CLERK_FRONTEND_API_URL`, `ENGINE_SECRET` |
| Vercel project | `papaflow` on `sonnysanghas-projects` (`prj_SP3inlGaaKH8SPSgO9z5HMmYcq4x`), GitHub connected, `vercel.ts` build command |
| Vercel env | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ENGINE_SECRET`, `CREDENTIALS_KEK`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` (prod/preview/dev); `APP_ORIGIN` (prod = https://papaflow.vercel.app, dev = http://localhost:3000); `CONVEX_DEPLOY_KEY` (production key) |
| Local | `.env.local` holds the Clerk dev keys, Convex dev deployment, `ENGINE_SECRET`, `CREDENTIALS_KEK`, `APP_ORIGIN`, `VERCEL_OIDC_TOKEN` |

## Dashboard steps still needed (only you can do these)

1. ✅ DONE (2026-09-02) **Clerk ↔ Convex integration** — https://dashboard.clerk.com/apps/setup/convex → select **PapaFlow** (Development) → **Activate Convex integration**. The Frontend API URL shown must be `https://curious-cat-3256.clerk.accounts.dev` (already set on both Convex deployments).
2. **Convex preview deploy key (optional; only for PR preview deployments)** — https://dashboard.convex.dev/t/sonny-sangha/papaflow → Project Settings → **Generate Preview Deploy Key** → `vercel env add CONVEX_DEPLOY_KEY preview --value 'preview:…' --yes`.
3. **Platform email fallback (optional)** — create a key at https://resend.com/api-keys and add `RESEND_API_KEY=` to `.env.local` (+ `vercel env add RESEND_API_KEY production --value … --yes`). Before a domain is verified Resend only delivers to the account's own email from `onboarding@resend.dev`.

Clerk is the source of truth for organisations, memberships and billing: no Clerk webhook, no mirror tables.

Everything else (AI keys, Slack/Discord/Telegram/Notion/Airtable/Linear/GitHub/Stripe credentials) is entered by users as **connections** inside the app — no operator setup.
