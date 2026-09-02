# verify:clerk

## SUMMARY
Pin @clerk/nextjs 7.8.4 + @clerk/backend 3.17.0 (Core 3; node >=20.9; peer next includes ^16.1.0-0, so next 16.3.4 is fine). Core 3 replaced <Protect>/<SignedIn>/<SignedOut> with <Show when=...> from '@clerk/nextjs'; @clerk/clerk-react -> @clerk/react; ClerkProvider inside <body>; getToken() throws ClerkOfflineError; createRouteMatcher() is deprecated and clerkMiddleware() protects nothing. Next 16 = proxy.ts (middleware.ts on 15), same matcher.

has() from `await auth()` (server) or useAuth() (client). Feature/plan strings accept an explicit scope prefix (ORG_SCOPES o|org|organization, USER_SCOPES u|user); unprefixed merges both. Session token v2: o:{id,slg,rol,per,fpm}, pla:"o:<slug>", fea:"o:a,o:b", sts, v:2; custom claims via Dashboard Sessions > Customize session token or `clerk config patch --json '{"session":{"claims":{...}}}'` (1.2KB budget). Only `{{org.name}}` is documented as an org shortcode; do not rely on {{org.id}} etc. without checking the Claims editor.

Billing: 0.7% on top of Stripe; dev uses Clerk's shared test gateway; prod needs your own Stripe account + owned domain (no *.vercel.app). `clerk enable billing --for orgs --yes` sets billing.organization_enabled (auto-enables orgs) and creates the default org plan slug `free_org` (key PLAN_LIMITS on that). Plans/features are config-as-code: billing.plans.<slug> / billing.features.<slug> via `clerk config patch` (Backend API only lists: GET /billing/plans). Seat-based settings are Dashboard-only. clerkClient.billing.* is public beta; useSubscription from '@clerk/nextjs/experimental'.

Webhooks: headers svix-id/svix-timestamp/svix-signature; verifyWebhook (@clerk/nextjs/webhooks | @clerk/backend/webhooks) reads CLERK_WEBHOOK_SIGNING_SECRET; Convex httpAction uses `svix`. Event names verified from Webhooks.ts. subscriptionItem.* data: status (snake_case incl. past_due), period_end, plan.slug, payer.organization_id; `is_free_trial` is NOT on the webhook TS type (treat optional). Endpoint creation: docs now claim `clerk api` can create endpoints and return the secret, but CLI 3.2.0's route list only has Svix-app routes -> treat as MANUAL until verified with `clerk api ls webhook` after `clerk update` (3.3.0).

Native Convex integration is Dashboard-only (dashboard.clerk.com/apps/setup/convex, "Activate Convex integration"; aud pre-mapped). auth.config.ts: domain = Frontend API URL, applicationID 'convex'. ConvexProviderWithClerk sends the raw session token when sessionClaims.aud === 'convex' (else JWT template 'convex', which lacks pla/fea) and re-auths on orgId/orgRole/sessionId change. Convex exposes custom claims; nested ones flatten to dotted keys (identity["o.id"]) - log once. Local skills exist (clerk-cli pinned to 1.4.0, clerk-billing 1.1.0 with a wrong array-shaped PATCH example).

## VERSIONS
{
"@clerk/nextjs": "7.8.4",
"@clerk/backend": "3.17.0",
"next": "16.3.4",
"convex": "1.45.0",
"svix": "2.2.0",
"clerk (CLI, npm package 'clerk')": "3.3.0 latest on npm; 3.2.0 installed on this machine (facts below verified against 3.2.0)",
"@clerk/react": "6.14.8 (Core 3 React package; not needed directly, convex peerDep ^6.4.3 satisfied)",
"@clerk/shared": "4.30.2 (transitive; source of has() scope logic)"
}

## COMMANDS
- clerk --version   # 3.2.0 installed; npm latest 3.3.0 (optional: `clerk update`, then re-run `clerk api ls webhook`)
- clerk whoami   # sonny.sangha@gmail.com, linked: null
- clerk apps create "PapaFlow" --json   # POST /v1/platform/applications; JSON includes application_id + instances[] (dev instance, publishable_key; secret_key stripped)
- clerk link --app <application_id>   # run inside /Users/sonnysangha/Downloads/papaflow
- clerk doctor --json
- clerk enable orgs --max-members 5 --yes   # organization_settings.enabled=true, max_allowed_memberships=5 (add --force-selection to require an active org)
- clerk enable billing --for orgs --yes --no-skills   # billing.organization_enabled=true (+ orgs); auto-creates default org plan slug free_org; needs a claimed (non-keyless) app
- clerk config schema --keys billing session organization_settings
- clerk config pull --keys billing organization_settings session
- clerk config patch --json '{"billing":{"features":{"core_connectors":{"name":"Core connectors"},"pro_connectors":{"name":"Pro connectors"},"ai_agent":{"name":"AI agent"},"ai_builder":{"name":"AI builder"},"schedules":{"name":"Schedules"},"run_history_30d":{"name":"30-day run history"},"shared_connections":{"name":"Shared connections"},"audit_log":{"name":"Audit log"},"priority_runs":{"name":"Priority runs"}},"plans":{"free_org":{"features":["core_connectors"]},"pro":{"name":"Pro","payer_type":"org","amount":2900,"annual_monthly_amount":2400,"currency":"usd","free_trial_enabled":true,"free_trial_days":7,"features":["core_connectors","pro_connectors","ai_agent","ai_builder","schedules","run_history_30d"]},"team":{"name":"Team","payer_type":"org","amount":9900,"currency":"usd","features":["core_connectors","pro_connectors","ai_agent","ai_builder","schedules","run_history_30d","shared_connections","audit_log","priority_runs"]}}}}' --dry-run   # validate, then re-run with --yes (prices are placeholders; slug = object key)
- clerk api /billing/plans   # GET only; confirm slugs free_org / pro / team
- MANUAL: Dashboard > Subscription plans > Plans for Organizations > Team > Seat-based (Custom limit / Cost per member seat monthly / Included seats) - no seat keys in the config schema
- clerk env pull --file .env.local   # NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY (dev)
- MANUAL: Dashboard > https://dashboard.clerk.com/apps/setup/convex > Activate Convex integration > copy Frontend API URL (aud 'convex' pre-mapped; no CLI/API route found)
- clerk config pull --keys session   # after activating: see how the aud claim is stored; if it is session.claims.aud, future apps can use `clerk config patch --json '{"session":{"claims":{"aud":"convex"}}}' --yes`
- npx convex env set CLERK_FRONTEND_API_URL https://<verb-noun-00>.clerk.accounts.dev
- clerk config patch --json '{"session":{"claims":{"org_name":"{{org.name}}"}}}' --dry-run   # optional custom claim; only {{org.name}} is documented - prefer reading the default o.id / o.rol claims in Convex
- MANUAL: Dashboard > Webhooks > Add Endpoint > URL https://<deployment>.convex.site/clerk-webhook > subscribe organization.*, organizationMembership.*, subscription.*, subscriptionItem.* > Create > copy Signing Secret  (first try `clerk api ls webhook` on CLI >= 3.3.0: docs say `clerk api <path> -X POST -d '<json>' --yes` creates the endpoint and returns the secret; 3.2.0 exposes only /webhooks/svix routes)
- npx convex env set CLERK_WEBHOOK_SIGNING_SECRET whsec_...
- clerk webhooks token --json   # once; { "token": "c_XXXXXXXXXX" }
- clerk webhooks listen --token "$(clerk webhooks token)" --forward-to http://localhost:3000/api/webhooks   # prints a Relay URL; MANUAL: register that Relay URL as a second Dashboard endpoint for local dev
- clerk webhooks verify --secret whsec_... --delivery @event.json --json
- clerk deploy   # guided dev -> production clone; needs an owned domain + DNS (CNAME clerk.<domain>, accounts.<domain>, clkmail.<domain>)
- clerk deploy status --wait   # read-only; --wait polls DNS/SSL/email verification (the --wait flag lives on `status`, not on `deploy`)
- clerk env pull --instance prod --file .env.production.local
- MANUAL: Dashboard (production instance) > Billing settings > connect your own Stripe account; custom domain on Vercel (no *.vercel.app)

## NON-CONFIRMED FACTS (11 of 37)
- [partially] CLAUDE.md rule 10: use has({ feature: 'org:slug' }) with the explicit org: prefix
  TRUTH: Valid but not mandatory. @clerk/shared authorization.ts: ORG_SCOPES = new Set(['o','org','organization']); USER_SCOPES = new Set(['u','user']); checkForFeatureOrPlan splits on ':' and, with an explicit scope, searches only that scope; without one it merges: '[...orgFeatures, ...userFeatures].includes(id)' ('Since org scoped features will not exist if there is not an active org, merging is safe'). B2B docs examples are unprefixed (has({ feature: 'widgets' }), has({ plan: 'gold' })). Keep org: for PapaFlow (stricter).
  SRC: https://raw.githubusercontent.com/clerk/javascript/main/packages/shared/src/authorization.ts ; https://clerk.com/docs/nextjs/guides/billing/for-b2b
- [partially] PLAN: plans are created in the dashboard under 'Plans for Organizations' (dashboard only)
  TRUTH: Dashboard: Subscription plans > 'Plans for Organizations' tab > Add Plan; features via plan > Add Feature. BUT instance config exposes billing as code (clerk config schema, live): billing.plans.<slug> { name, description, amount (monthly cents), annual_monthly_amount, currency, features: [slugs] ('Empty array clears all features; omit to leave attachments unchanged'), free_trial_enabled, free_trial_days, is_recurring (true), payer_type 'user'|'org' ('Must match an enabled billing type'), publicly_visible } and billing.features.<slug> { name, description, include_in_jwt (true), jwt_value, publicly_visible, avatar_url }. Backend API has only GET /billing/plans (no create). Object key = slug; slug rules undocumented. The local clerk-billing skill's raw PATCH example uses arrays ('plans':[{slug...}]) which does NOT match the live schema (keyed objects).
  SRC: clerk config schema --app app_3IXYeMsuXyYU8dotjy01HYqRIib ; clerk api ls billing ; https://clerk.com/docs/nextjs/guides/billing/for-b2b ; /Users/sonnysangha/.claude/skills/clerk-billing/SKILL.md line 82
- [partially] PLAN: features are booleans only; no quantity/metering
  TRUTH: No metering, so PLAN_LIMITS stays in code. But billing.features.<slug>.include_in_jwt (bool, default true) and jwt_value ('Optional custom value included in JWT claims') let a feature carry a static value into the session token.
  SRC: clerk config schema --app <id> --keys billing
- [partially] PLAN: orgPlans synced from subscriptionItem.* keyed on payer.organization_id storing plan.slug, status, period_end, is_free_trial
  TRUTH: BillingSubscriptionItemWebhookEventJSON: status: 'abandoned'|'active'|'canceled'|'ended'|'expired'|'incomplete'|'past_due'|'upcoming'; plan_period; period_start: number; period_end: number|null; canceled_at?; past_due_at?; amount; credit; proration_date; lifetime_paid; next_payment_amount/date; plan?: { id, instance_id, product_id, name, slug, description?, is_default, is_recurring, amount, period, interval, has_base_fee, currency, annual_monthly_amount, publicly_visible } | null; plan_id?; payer?: BillingPayerJSON { user_id?, organization_id?, organization_name?, email, first_name?, last_name?, image_url }. is_free_trial exists on the API resource BillingSubscriptionItemJSON but is ABSENT from the webhook type, while the free-trials guide says to read data.is_free_trial on subscriptionItem.active -> type as optional, log one real payload. Note snake_case 'past_due' in data vs event name subscriptionItem.pastDue.
  SRC: https://raw.githubusercontent.com/clerk/javascript/main/packages/backend/src/api/resources/JSON.ts ; https://clerk.com/docs/guides/billing/free-trials
- [unverifiable] A webhook endpoint pointing at the Convex .convex.site URL can be created and its secret read via clerk api
  TRUTH: Contradictory sources. Docs (syncing guide, 'For AI agents'): 'run npx clerk@latest api ls webhook to find the endpoints API, then npx clerk@latest api <path> -X POST -d '<json>' to create the endpoint and read back its signing secret.' But installed CLI 3.2.0 `clerk api ls webhook` lists only POST/DELETE /webhooks/svix (Svix app) and POST /webhooks/svix_url; Platform API has no webhook routes; config schema has no webhooks key; the BAPI reference tag page 404s. At install time: `clerk update` (3.3.0 latest) then `clerk api ls webhook`; if an endpoints route appears, create with `clerk api <path> -X POST -d '{"url":"https://<deployment>.convex.site/clerk-webhook",...}' --yes`. Otherwise MANUAL: Dashboard > Webhooks > Add Endpoint > URL > Subscribe to events > Create > copy Signing Secret.
  SRC: https://clerk.com/docs/guides/development/webhooks/syncing ; clerk api ls webhook (3.2.0) ; clerk api ls --platform ; https://clerk.com/docs/reference/backend-api/2026-05-12/tag/webhooks (404)
- [unverifiable] The Convex integration can be enabled via clerk api / clerk config patch
  TRUTH: No integrations/convex/aud key in the instance config schema (top-level: auth_*, billing, branding, compliance, connection_oauth_*, connections_oauth_custom, organization_settings, paths, session {allowed_clock_skew, claims, lifetime}, session_settings, user_model); no BAPI/Platform route mentions Convex; docs describe Dashboard only. Because the integration is described as a pre-mapped aud claim in the Sessions Claims editor, `clerk config patch --json '{"session":{"claims":{"aud":"convex"}}}' --yes` is a plausible equivalent (aud is not in the reserved list azp/exp/iat/iss/jti/nbf/sub) but untested: activate in the Dashboard once, then `clerk config pull --keys session` to see how Clerk stores it. Fallback that IS API-creatable: a JWT template named 'convex' (`clerk api /jwt_templates -X POST -d '{"name":"convex","claims":{"aud":"convex"}}' --yes`), used automatically by ConvexProviderWithClerk when aud !== 'convex', but template tokens exclude sid/v/pla/fea so plan claims would not reach Convex.
  SRC: clerk config schema --app app_3IXYeMsuXyYU8dotjy01HYqRIib ; clerk api ls jwt ; https://clerk.com/docs/guides/sessions/jwt-templates ; ConvexProviderWithClerk.tsx
- [partially] PLAN: add readable org_id / org_role custom claims via shortcodes and read them in ctx.auth.getUserIdentity()
  TRUTH: Custom claims do pass through: convex-js UserIdentity has `[key: string]: JSONValue | undefined // Any custom claims.` and Convex docs say nested JWT fields are 'accessible ... like authInfo["properties.id"]' (dotted flattened keys), so the default o claim should surface as identity['o.id'], identity['o.rol'], identity['o.slg'] and pla/fea as top-level strings - log once in dev to confirm. Only `{{org.name}}` is documented as an org shortcode (org-slugs guide: {"org_name": "{{org.name}}"}); `{{org.id}}`/`{{org.slug}}`/`{{org.role}}` appear in third-party posts only -> confirm in the Dashboard Claims editor before use. Custom claims may be unnecessary given the o claim.
  SRC: https://raw.githubusercontent.com/get-convex/convex-js/main/src/server/authentication.ts ; https://docs.convex.dev/auth/functions-auth ; https://docs.convex.dev/auth/advanced/custom-jwt ; https://clerk.com/docs/guides/organizations/org-slugs-in-urls ; https://clerk.com/docs/guides/sessions/jwt-templates
- [partially] clerk apps create <name> creates an application with a dev instance and keys
  TRUTH: Binary: `clerk apps create <name> [--json]` (only flag). Output is the application object with `instances` where secret_key is stripped (`instances: T.instances.map(({secret_key, ...R}) => R)`); agent mode/piped defaults to JSON. `clerk apps list --json` shows every app with instances [{instance_id, environment_type: 'development', publishable_key}], so a development instance is created; secret keys never print - use `clerk env pull` after `clerk link --app <id>`. Positional <name> cannot come from --input-json. Response shape not documented (Platform API reference 404) - read application_id from the JSON at run time.
  SRC: strings of CLI binary (command('create') definition, AH() instance mapper) ; clerk apps list --json ; /Users/sonnysangha/.claude/skills/clerk-cli/references/agent-mode.md
- [wrong] Clerk CLI 3.2.0 leaf `--help` works for nested subcommands
  TRUTH: Group help (`clerk apps --help`, `clerk enable --help`, ...) works; leaf `--help` printed the root help in the researcher's run (not re-tested here). All leaf flags above were taken from the command definitions embedded in the 3.2.0 binary. npm latest is 3.3.0 (2026-09-01: 'list --help commands and options alphabetically', keyless->accountless copy); 3.2.0 (2026-08-24) added OAuth session revocation, 15-minute browser auth timeout, error codes.
  SRC: strings /Users/sonnysangha/.nvm/versions/node/v24.14.1/lib/node_modules/clerk/node_modules/@clerk/cli-darwin-arm64/bin/clerk ; npm view clerk version ; https://github.com/clerk/cli/releases
- [partially] clerk deploy usage and production requirements (custom domain, own Stripe)
  TRUTH: `clerk deploy` (hidden default subcommand 'run') is the guided walkthrough cloning dev -> production; `--wait` ('Wait for DNS, SSL, and email DNS verification with retries') is a flag of `clerk deploy status`, NOT of `clerk deploy`; agent JSON output comes from the root `--mode agent` flag (or piped stdout), not a deploy-specific flag. Docs: 'You will need to have a domain you own' and 'be able to add DNS records on your domain'; DNS CNAMEs clerk.<domain> (Frontend API), accounts.<domain>, clkmail.<domain>, propagation 'up to 48hrs'; then `clerk env pull --instance prod`. *.vercel.app cannot be a production Clerk domain (no DNS control). Production billing needs your own Stripe account (dev test accounts cannot be reused).
  SRC: strings of CLI binary (deploy command definitions) ; https://clerk.com/docs/guides/development/deployment/production ; https://clerk.com/changelog/2026-06-10-clerk-deploy ; https://clerk.com/docs/guides/billing/overview
- [partially] Local skills clerk-cli and clerk-billing exist and match live docs
  TRUTH: /Users/sonnysangha/.claude/skills/clerk-cli/SKILL.md exists, pinned to clerk 1.4.0 (installed 3.2.0; predates enable/deploy/webhooks). /Users/sonnysangha/.claude/skills/clerk-billing is a symlink to ~/.agents/skills/clerk-billing (SKILL.md v1.1.0 + references b2b-patterns.md, billing-webhooks.md, ...) - the researcher's 'not found' was wrong. Drift in clerk-billing: `--for org` (CLI wants orgs), raw PATCH example with array-shaped billing.plans/features (live schema uses slug-keyed objects), links to seat-limit-plans (live page is seat-based-plans), a `subscriptionItem.expired` event that is not in Webhooks.ts. Its payer.organization_id / one-active-item-per-payer guidance matches the types.
  SRC: ls -la /Users/sonnysangha/.claude/skills ; /Users/sonnysangha/.claude/skills/clerk-cli/SKILL.md line 16 ; /Users/sonnysangha/.claude/skills/clerk-billing/SKILL.md ; references/b2b-patterns.md

## CONFIRMED FACTS
- CLAUDE.md rule 10 / PLAN: Clerk Core 3 (March 2026) removed <Protect>; <Show when={...}> is the replacement → Changelog: '<Protect>, <SignedIn>, and <SignedOut> are replaced by a single <Show> component'. import { Show } from '@clerk/nextjs'. Props: when: 'signed-in' | 'signed-out' | {feature} | {permission} | {plan} | {role} | (has) => boolean; fallback?: JSX; treatP
- CLAUDE.md rule 10 / PLAN: Billing types are public beta; useSubscription lives under @clerk/nextjs/experimental → BillingApi.ts JSDoc on every method: 'Experimental API for the Billing feature that is available under a public beta ... subject to change ... pin the SDK version and the clerk-js version'. useSubscription: import from '@clerk/nextjs/experimental'; params { en
- Current @clerk/nextjs major and support for the current Next.js major → npm: @clerk/nextjs latest 7.8.4 (dist-tag canary-core3 = 7.0.0-canary-core3...); peerDependencies.next '^15.2.8 || ^15.3.8 || ^15.4.10 || ^15.5.9 || ^15.6.0-0 || ^16.0.10 || ^16.1.0-0' (next latest 16.3.4 satisfies ^16.1.0-0); react '^18.0.0 || ~19.0.3 || ~19.
- Middleware file name and recommended matcher in the current Next.js major → Quickstart: 'Name the middleware file by the next version in package.json: proxy.ts on Next.js 16+, middleware.ts on 15 and below.' clerk-middleware reference: 'the code itself remains the same; only the filename changes'; matcher ['/((?!_next|[^?]*\\.(?:html?
- auth() / has() usage on the server and client → Server: import { auth } from '@clerk/nextjs/server'; const { has, orgId, orgSlug, orgRole, userId, sessionClaims } = await auth() (async). Client: import { useAuth } from '@clerk/nextjs'; useAuth() returns { isLoaded, isSignedIn, userId, sessionId, orgId, orgR
- <OrganizationSwitcher>, <OrganizationList>, <CreateOrganization> import from @clerk/nextjs → OrganizationSwitcher props (all optional): afterCreateOrganizationUrl, afterLeaveOrganizationUrl, afterSelectOrganizationUrl, afterSelectPersonalUrl, appearance, createOrganizationMode 'modal'|'navigation', createOrganizationUrl, defaultOpen, fallback, hidePer
- PLAN: Clerk Billing charges 0.7% on top of Stripe; shared test gateway in dev; own Stripe account in production → B2B guide: '0.7% per transaction, plus transaction fees which are paid directly to Stripe'; pricing page: '0.7% of billing volume (on top of Stripe's 2.9% + $0.30 per transaction)'. Dev: 'Clerk development gateway' (shared test Stripe account). 'Stripe account
- PLAN: every org lands on the Free plan automatically → B2B guide: 'All Organizations start on the Free Plan'. Config schema billing.organization_enabled: 'When enabled, a default free plan (free_org) is created automatically. Requires organizations to be enabled on the instance.' (user side: free_user). PLAN_LIMIT
- PLAN: Pro plan with 7-day trial → Per plan: 'Enable Free trial and set the number of trial days (minimum is 1 day)'; config keys billing.plans.<slug>.free_trial_enabled / free_trial_days. Payment method required by default: billing.free_trial_requires_payment_method (default true; Dashboard 'R
- PLAN: Team is per-seat; seat limits above 20 or unlimited need the $100/mo B2B add-on; cap Pro at 5 → Seat-based plans: New Organization Plan page, enable Seat-based; fields Seat limit ('Custom limit' or 'Unlimited members'), 'Cost per member seat monthly', 'Included seats'. 'The B2B Authentication add-on is required to set a custom limit greater than 20 seats
- <PricingTable for="organization" /> props → import { PricingTable } from '@clerk/nextjs'. Props: for 'user'|'organization' (default 'user'), highlightedPlan (slug, 'Popular' badge), newSubscriptionRedirectUrl, checkoutProps, ctaPosition 'top'|'bottom' (default 'bottom'), collapseFeatures (false), fallba
- clerkClient.billing.* method names and beta status; getOrganizationBillingSubscription exists → BillingApi.ts: getPlanList(params?: GetPlanListParams) -> GET /billing/plans; getOrganizationBillingSubscription(organizationId: string): Promise<BillingSubscription> -> GET /organizations/{id}/billing/subscription; getUserBillingSubscription(userId); cancelSu
- Billing webhook event names (subscription.* vs subscriptionItem.*) → Webhooks.ts literals: subscription.created|updated|active|pastDue -> BillingSubscriptionWebhookEventJSON; subscriptionItem.created|updated|active|canceled|upcoming|ended|abandoned|incomplete|pastDue|freeTrialEnding -> BillingSubscriptionItemWebhookEventJSON; p
- Webhook verification: svix headers, helper and signing-secret env var → packages/backend/src/webhooks.ts reads svix-id, svix-timestamp, svix-signature; `export async function verifyWebhook(request: Request, options: VerifyWebhookOptions = {}): Promise<WebhookEvent>`, VerifyWebhookOptions = { signingSecret?: string }, default env C
- Clerk CLI can relay webhooks locally → `clerk webhooks token [--json]` prints c_ + 10 base62. `clerk webhooks listen --forward-to <url> (required) [--token <c_token>] [-H key:value]` prints a Relay URL; binary text: 'Register the Relay URL it prints as an endpoint in your Clerk Dashboard'. `clerk w
- PLAN/KICKOFF: native Convex integration, no JWT template; session token carries aud: 'convex' → Clerk docs: 'navigate to the Convex integration setup (https://dashboard.clerk.com/apps/setup/convex) ... select Activate Convex integration. This will reveal the Frontend API URL'; 'In the Claims section, the default audience (aud) claim required by Convex is
- convex/auth.config.ts must contain domain = Frontend API URL and applicationID = 'convex' → Clerk docs: providers: [{ domain: process.env.CLERK_FRONTEND_API_URL!, applicationID: 'convex' }] satisfies AuthConfig (import type { AuthConfig } from 'convex/server'); set with `npx convex env set CLERK_FRONTEND_API_URL https://verb-noun-00.clerk.accounts.de
- ConvexProviderWithClerk wiring with useAuth from @clerk/nextjs; re-authenticates when the active org changes → 'use client'; import { ConvexReactClient } from 'convex/react'; import { ConvexProviderWithClerk } from 'convex/react-clerk'; import { useAuth } from '@clerk/nextjs'; <ConvexProviderWithClerk client={convex} useAuth={useAuth}>. 'It's important that <ClerkProvi
- Default v2 session token claims (o: {id, rol, slg, per, fpm}, pla, fea, sts) → v2 claims: azp, exp, fva, iat, iss (Frontend API URL), jti, nbf, sid, sub, v, sts, pla ('scope:planslug', u:free or o:pro), fea ('o:dashboard,o:impersonation'; o: with active org, u: otherwise), o: { id, slg, rol (no org: prefix), per, fpm (bitmask map) }. v2 
- Organizations can be enabled non-interactively → Binary command def: `clerk enable orgs|organizations [--app <id>] [--instance <id>] [--force-selection] [--auto-create] [--max-members <n>] [--domains] [--yes] [--dry-run]`; patches organization_settings { enabled: true, force_organization_selection, domains_e
- Billing for orgs can be enabled non-interactively with `clerk enable billing --for orgs` → Binary: `clerk enable billing [--for <targets...>] [--app <id>] [--instance <id>] [--yes] [--dry-run] [--no-skills]`; --for accepts 'orgs' and/or 'users' (allowed set ["orgs","users"]; defaults to both). Sets billing.organization_enabled=true (and organization
- clerk link / env pull / config patch / api flags → `clerk link --app <id>`. `clerk env pull [--app <id>] [--instance dev|prod|ins_id] [--file <path>]` writes NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY. `clerk config pull [--app] [--instance] [--output f] [--keys k1 k2]`; `clerk config schema [--keys 
- CLAUDE.md Env vars: CLERK_* and CLERK_WEBHOOK_SIGNING_SECRET → Next.js: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY (pk_test_/sk_test_ dev, pk_live_/sk_live_ prod) written by `clerk env pull`. Convex (`npx convex env set`): CLERK_FRONTEND_API_URL (issuer for auth.config.ts; Convex docs name it CLERK_JWT_ISSUER_DOM
- Core 3 other breaking changes relevant to the plan → Node 20.9+; @clerk/clerk-react -> @clerk/react, @clerk/clerk-expo -> @clerk/expo; types package deprecated (import types from the SDK); ClerkProvider 'inside <body>, not wrapping <html>'; getToken() throws ClerkOfflineError, useAuth().getToken always defined; 
- Organization webhook payload shapes (organization.*, organizationMembership.*) → OrganizationJSON: { id, object, name, slug: string, image_url?, has_image, members_count?, pending_invitations_count?, max_allowed_memberships, admin_delete_enabled, public_metadata, private_metadata?, created_by?, created_at, updated_at, last_active_at?, role
- JWT templates can be created via Backend API (fallback for aud: convex) → BAPI: POST /jwt_templates (also GET/PATCH/DELETE /jwt_templates/{id}); required fields name and claims; lifetime (s, default 60), allowed_clock_skew (default 5). Docs CLI example: `npx clerk@latest api jwt_templates -d '{"name":"my-template","claims":{...},"li

## SNIPPETS
### proxy.ts (Next 16; name it middleware.ts on Next <=15)
```
import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware() // protects nothing by default; check auth next to the data

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}
```
### app/layout.tsx + app/ConvexClientProvider.tsx (ClerkProvider inside <body>)
```
// app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs'
import ConvexClientProvider from './ConvexClientProvider'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <ClerkProvider><ConvexClientProvider>{children}</ConvexClientProvider></ClerkProvider>
    </body></html>
  )
}

// app/ConvexClientProvider.tsx
'use client'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useAuth } from '@clerk/nextjs'
if (!process.env.NEXT_PUBLIC_CONVEX_URL) throw new Error('Missing NEXT_PUBLIC_CONVEX_URL')
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL)
export default function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return <ConvexProviderWithClerk client={convex} useAuth={useAuth}>{children}</ConvexProviderWithClerk>
}
```
### convex/auth.config.ts (native integration; applicationID must be 'convex')
```
import type { AuthConfig } from 'convex/server'

export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL!, // dev https://verb-noun-00.clerk.accounts.dev, prod https://clerk.<domain>
      applicationID: 'convex',                    // must equal the token's aud
    },
  ],
} satisfies AuthConfig
```
### <Show> gates (Core 3)
```
import { Show } from '@clerk/nextjs'

<Show when={{ feature: 'org:pro_connectors' }} fallback={<UpgradeCard />}>
  <ProNodeCards />
</Show>

<Show when={{ permission: 'org:sys_billing:manage' }}>...</Show>
<Show when={(has) => has({ plan: 'org:pro' }) || has({ plan: 'org:team' })}>...</Show>
<Show when="signed-in" fallback={<SignInPrompt />}>...</Show>
```
### has() on the server (route handler / server action)
```
import { auth } from '@clerk/nextjs/server'

export async function POST() {
  const { isAuthenticated, orgId, has } = await auth() // auth() is async
  if (!isAuthenticated || !orgId) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (!has({ feature: 'org:ai_builder' })) return Response.json({ error: 'Upgrade required' }, { status: 403 })
  // ...
}

// client: const { has, orgId } = useAuth() from '@clerk/nextjs'
```
### PricingTable + useSubscription (org scope)
```
import { PricingTable } from '@clerk/nextjs'
<PricingTable for="organization" highlightedPlan="pro" newSubscriptionRedirectUrl="/settings/billing" />

'use client'
import { useSubscription } from '@clerk/nextjs/experimental' // display only; authorize with has()
const { data, isLoading, error, revalidate } = useSubscription({ for: 'organization' })
```
### clerkClient.billing (public beta) from a server context
```
import { clerkClient } from '@clerk/nextjs/server'

const client = await clerkClient()
const sub = await client.billing.getOrganizationBillingSubscription('org_123') // Promise<BillingSubscription>
// sub.status: 'abandoned'|'active'|'ended'|'canceled'|'incomplete'|'past_due'
// sub.subscriptionItems[i]: { status, plan?.slug, periodEnd: number|null, isFreeTrial, planPeriod, seats? }
await client.billing.extendSubscriptionItemFreeTrial('subi_123', { extendTo: new Date('2026-12-31') })
```
### Convex httpAction for the Clerk webhook (svix verification)
```
// convex/http.ts
import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { Webhook } from 'svix'
import type { ClerkWebhookEvent } from './clerkTypes'

const http = httpRouter()
http.route({ path: '/clerk-webhook', method: 'POST', handler: httpAction(async (ctx, req) => {
  const payload = await req.text() // raw body first
  const headers = {
    'svix-id': req.headers.get('svix-id')!,
    'svix-timestamp': req.headers.get('svix-timestamp')!,
    'svix-signature': req.headers.get('svix-signature')!,
  }
  let evt: ClerkWebhookEvent
  try { evt = new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET!).verify(payload, headers) as ClerkWebhookEvent }
  catch { return new Response('bad signature', { status: 400 }) }
  // idempotency: dedupe on headers['svix-id']
  switch (evt.type) { /* organization.*, organizationMembership.*, subscriptionItem.* */ }
  return new Response(null, { status: 200 })
}) })
export default http
```
### Webhook payload TypeScript shape (from @clerk/backend Webhooks.ts / JSON.ts)
```
type Webhook<T, D> = { type: T; object: 'event'; data: D; timestamp?: number; instance_id?: string; event_attributes?: { http_request: { client_ip: string; user_agent: string } } }
type Payer = { id: string; user_id?: string; organization_id?: string; organization_name?: string; email: string }
type SubItemStatus = 'abandoned'|'active'|'canceled'|'ended'|'expired'|'incomplete'|'past_due'|'upcoming'
type SubItemData = {
  id: string; status: SubItemStatus; plan_period: 'month'|'annual';
  period_start: number; period_end: number | null; canceled_at?: number; past_due_at?: number;
  plan?: { id: string; name: string; slug: string; is_default: boolean; is_recurring: boolean; amount: number; period: 'month'|'annual'; currency: string; annual_monthly_amount: number } | null;
  plan_id?: string | null; payer?: Payer; is_free_trial?: boolean /* documented on subscriptionItem.active, absent from the TS type: log once */
}
type OrgData = { id: string; name: string; slug: string; created_by?: string; members_count?: number; max_allowed_memberships: number; public_metadata: Record<string, unknown> | null }
type MembershipData = { id: string; role: string; permissions: string[]; organization: OrgData; public_user_data: { user_id: string; identifier: string; first_name: string|null; last_name: string|null; image_url: string } }
export type ClerkWebhookEvent =
  | Webhook<'organization.created'|'organization.updated', OrgData>
  | Webhook<'organization.deleted', { id?: string; slug?: string; object: string; deleted: boolean }>
  | Webhook<'organizationMembership.created'|'organizationMembership.updated'|'organizationMembership.deleted', MembershipData>
  | Webhook<'subscription.created'|'subscription.updated'|'subscription.active'|'subscription.pastDue', { id: string; status: SubItemStatus; payer_id: string; payer: Payer; items: SubItemData[] }>
  | Webhook<'subscriptionItem.created'|'subscriptionItem.updated'|'subscriptionItem.active'|'subscriptionItem.canceled'|'subscriptionItem.upcoming'|'subscriptionItem.ended'|'subscriptionItem.abandoned'|'subscriptionItem.incomplete'|'subscriptionItem.pastDue'|'subscriptionItem.freeTrialEnding', SubItemData>
  | Webhook<'paymentAttempt.created'|'paymentAttempt.updated', { id: string; status: 'pending'|'paid'|'failed'; charge_type: 'checkout'|'recurring'; payer: Payer; subscription_items: SubItemData[] }>
```
### Next.js route-handler webhook (only if you also want one on Vercel)
```
import { verifyWebhook } from '@clerk/nextjs/webhooks' // reads CLERK_WEBHOOK_SIGNING_SECRET; also '@clerk/backend/webhooks'
import type { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const evt = await verifyWebhook(req) // Promise<WebhookEvent>; evt.type, evt.data
    return new Response('ok', { status: 200 })
  } catch {
    return new Response('bad signature', { status: 400 })
  }
}
```
### Session token v2 claims the Convex token carries + how Convex exposes them (log once in dev)
```
// decoded Clerk session token with an active org + org billing
{ "iss": "https://verb-noun-00.clerk.accounts.dev", "aud": "convex", "sub": "user_...", "sid": "sess_...", "v": 2, "sts": "active",
  "o": { "id": "org_...", "slg": "acme", "rol": "admin", "per": "sys_profile:manage,...", "fpm": "3,1" },
  "pla": "o:pro", "fea": "o:core_connectors,o:pro_connectors,o:ai_agent" }

// convex/lib/auth.ts
export async function requireOrg(ctx: { auth: { getUserIdentity(): Promise<any> } }) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Unauthenticated')
  // Convex flattens nested claims to dotted keys (docs: authInfo["properties.id"]) -> expect identity['o.id']
  const orgId = (identity['o.id'] ?? identity.org_id) as string | undefined // confirm by logging once
  const plan = (identity.pla as string | undefined)?.replace(/^o:/, '')     // 'free_org' | 'pro' | 'team'
  if (!orgId) throw new Error('No active organization')
  return { userId: identity.subject, orgId, plan, role: identity['o.rol'] as string | undefined }
}
```
### Convex-side plan map keyed by the real default slug
```
export const PLAN_LIMITS = {
  free_org: { workflows: 3, runsPerMonth: 100, members: 1, minScheduleMs: 60 * 60_000 }, // Clerk's auto-created default org plan slug
  pro:      { workflows: Infinity, runsPerMonth: 5_000, members: 5, minScheduleMs: 60_000 },
  team:     { workflows: Infinity, runsPerMonth: 50_000, members: Infinity, minScheduleMs: 60_000 },
} as const
export type PlanSlug = keyof typeof PLAN_LIMITS
```
### Fallback if the Convex integration cannot be activated non-interactively (JWT template 'convex')
```
# ConvexProviderWithClerk uses getToken({ template: 'convex' }) whenever sessionClaims.aud !== 'convex'
clerk api /jwt_templates -X POST -d '{"name":"convex","claims":{"aud":"convex"}}' --yes
# Caveat: template tokens exclude sid/v/pla/fea, so plan/feature claims will NOT reach ctx.auth.getUserIdentity();
# prefer the Dashboard 'Activate Convex integration' (raw session token) for PapaFlow.
```
