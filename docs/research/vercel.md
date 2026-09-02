# verify:vercel

## SUMMARY
Installed CLI: vercel 54.18.6 (2026-06-30, at /Users/sonnysangha/Library/pnpm/global/v11/.../node_modules/vercel). npm latest: 59.11.2 (2026-09-02). Everything the plan needs exists in 54.18.6: project add, link --yes --project, env add (one env per command, --value/--yes, stdin), env pull, git connect --yes, deploy --yes/--prod/--dry, integration add/discover/guide/accept-terms, blob create-store, and vercel.ts (the 54.18.6 bundle contains 'vercel.ts' and '@vercel/config/v1' strings). Upgrading buys: `vercel project update` (54.21.1+), non-TTY link requiring explicit team (55.0.0, breaking), env pull preserving local-only vars (56.0.0), comma-separated env targets `production,preview` (56.2.0), vercel.toml (58.0.0). 59.0.0's notes are UNVERIFIABLE: github.com/vercel/vercel has no vercel@59 tags and its CHANGELOG/releases stop at 58.4.4 (2026-07-30) even though npm 59.x declares that repo; the "59 defaults middleware to Node" search snippet is contradicted by live docs, which still say Edge is the default middleware runtime.

Non-interactive flow: `vercel project add papaflow --scope sonnysanghas-projects` -> `vercel link --yes --scope sonnysanghas-projects --project papaflow` -> `vercel env add NAME production --value "..." --yes` (never combine development with production/preview; 3rd positional is a git branch) -> `vercel git connect --yes` (GitHub App must already be installed via browser; personal repo needs Owner) -> `vercel deploy --yes` (first deployment of a new project is ALWAYS production) / `vercel deploy --prod --yes`.

Marketplace (plan ids from `vercel integration add <x> --help`): Convex slug `convex`, `--plan CONVEX_BASE` (Free), metadata region/defaultRegion/spending*; creates a project in its own Convex team, syncs CONVEX_DEPLOY_KEY (Production+Preview enabled, Custom Prefix empty); build command must be `npx convex deploy --cmd 'pnpm build'`; NEXT_PUBLIC_CONVEX_URL is written by `npx convex deploy` at build, never set manually; CONVEX_DEPLOYMENT is local-only. Clerk slug `clerk`, `--plan hobby_2025_08` ($0), metadata domain/enhanced-authentication/enhanced-b2b-saas/enhanced-administration; injects NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY (dev instance -> development+preview, prod -> production). Organizations are NOT a Vercel flag: enable with `clerk enable orgs` (Clerk CLI, installed) or the Clerk dashboard. Resend slug `resend/resend-email`, `--plan free`, metadata `domain` (REQUIRED, you must own it) and `region` (REQUIRED) -> RESEND_API_KEY. First install per team needs interactive terms acceptance.

Blob: @vercel/blob 2.8.0, `put(pathname, body, { access: 'public'|'private' })` (access required), auth: token option > VERCEL_OIDC_TOKEN+BLOB_STORE_ID > BLOB_READ_WRITE_TOKEN; `vercel blob create-store <name> --access public --yes` connects and adds BLOB_STORE_ID/VERCEL_OIDC_TOKEN/BLOB_WEBHOOK_PUBLIC_KEY; `handleUpload` still needs a read-write token. Fluid is default-on since 2025-04-23 (300s default; 300s Hobby / 800s Pro max); Node 24.x default; Workflows use the Vercel World with zero config; Hobby 50k events/1 GB written; Queues are per-operation billed, no enablement step documented.

## VERSIONS
{
"vercel (npm latest)": "59.11.2",
"vercel (installed)": "54.18.6",
"@vercel/blob": "2.8.0",
"@vercel/config": "0.7.0",
"workflow": "5.0.0-beta.47 (dist-tag beta; latest stable 4.8.5)",
"node (Vercel default runtime)": "24.x"
}

## COMMANDS
- vercel --version   # 54.18.6 installed; npm latest 59.11.2 (2026-09-02)
- vercel upgrade --dry-run   # optional; upgrade only if you want `vercel project update` (>=54.21.1) or `env add NAME production,preview` (>=56.2.0); note 55+ requires --scope/--team on non-TTY link
- vercel whoami && vercel teams ls && vercel project ls --filter papaflow
- vercel project add papaflow --scope sonnysanghas-projects
- vercel link --yes --scope sonnysanghas-projects --project papaflow
- vercel project update papaflow --framework nextjs --build-command "npx convex deploy --cmd 'pnpm build'"   # CLI >= 54.21.1 only
- MANUAL: (CLI 54.18.6) Dashboard > Settings > Build and Deployment: Framework Next.js, Build Command `npx convex deploy --cmd 'pnpm build'`; or commit vercel.ts with framework/buildCommand (per-deployment override)
- MANUAL: Node 24.x is the default for new projects; pin with package.json "engines": {"node": "24.x"} (overrides dashboard). No CLI flag.
- MANUAL: Fluid Compute is already ON for projects created after 2025-04-23 (Settings > Functions > Fluid Compute); no CLI toggle
- vercel env add CREDENTIALS_KEK production --value "$KEK" --yes
- vercel env add CREDENTIALS_KEK preview --value "$KEK" --yes
- vercel env add CREDENTIALS_KEK development --value "$KEK" --yes   # development can never share a command with production/preview
- vercel env add ENGINE_SECRET production < engine-secret.txt   # stdin/file form
- vercel env add NAME production,preview --value "..." --yes   # CLI >= 56.2.0 only
- vercel env add NAME preview feat-branch --value "..." --yes   # branch is the 3rd positional, not --git-branch
- vercel env ls && vercel env pull .env.local --yes
- vercel env pull .env.preview.local --environment=preview --yes
- MANUAL: install the Vercel for GitHub App with access to the repo (browser, once; personal repo requires Owner)
- vercel git connect --yes   # or: vercel git connect https://github.com/<owner>/papaflow --yes
- vercel deploy --dry --format=json   # verify detected framework + vercel.ts before deploying
- vercel deploy --yes   # NOTE: the first deployment of a brand-new project is always production
- vercel deploy --prod --yes
- vercel build --prod && vercel deploy --prebuilt --prod --archive=tgz   # CI variant
- vercel integration discover convex --format=json   # slug: convex
- vercel integration discover resend --format=json   # slug: resend/resend-email
- vercel integration add convex --help   # prints plan ids (CONVEX_BASE/CONVEX_STARTER_PLUS/CONVEX_PROFESSIONAL) and metadata keys
- MANUAL (TTY, human): vercel integration accept-terms convex ; vercel integration accept-terms clerk ; vercel integration accept-terms resend   # first install of each integration on a team
- vercel integration add convex --plan CONVEX_BASE -m region=default -m defaultRegion=true -e production -e preview --name papaflow-convex
- vercel integration add clerk --plan hobby_2025_08 -e production -e preview -e development --name papaflow-clerk   # add -m domain=<prod-domain> when known; enhanced-* metadata are paid add-ons
- vercel integration add resend --plan free -m domain=<your-owned-domain> -m region=us-east-1 -e production -e preview -e development   # domain and region are REQUIRED
- vercel integration list --format=json && vercel env ls   # expect CONVEX_DEPLOY_KEY (prod+preview), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, RESEND_API_KEY
- vercel integration guide convex   # CONVEX_DEPLOY_KEY guidance + Next.js provider snippet (no --framework variant)
- vercel integration guide clerk --framework nextjs
- MANUAL/browser: npx convex login --vercel   # local dev login for the marketplace-created Convex team, then npx convex dev
- vercel integration open clerk   # SSO into the Clerk dashboard (browser)
- clerk link --app <app_id>   # Clerk CLI; then: clerk enable orgs   (Organizations are NOT settable from the Vercel CLI)
- vercel blob create-store papaflow-media --access public --yes --environment production --environment preview --environment development
- vercel blob list-stores && vercel env ls   # expect BLOB_STORE_ID, VERCEL_OIDC_TOKEN, BLOB_WEBHOOK_PUBLIC_KEY (BLOB_READ_WRITE_TOKEN only for dashboard-created stores or handleUpload client uploads)

## NON-CONFIRMED FACTS (19 of 39)
- [wrong] Env vars CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL must be set on Vercel (CLAUDE.md L115).
  TRUTH: Only CONVEX_DEPLOY_KEY belongs in Vercel. Convex docs: "`npx convex deploy` will read `CONVEX_DEPLOY_KEY` from the environment and use it to set the `CONVEX_URL` (or similarly named) environment variable to point to your **production** deployment"; rename with `--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` if it cannot be inferred. CONVEX_DEPLOYMENT is written to .env.local by `npx convex dev` and is not needed on Vercel (guide snippet: "This variable is not needed in development" applies to the deploy key; only CONVEX_DEPLOY_KEY is listed).
  SRC: https://docs.convex.dev/production/hosting/vercel ; https://docs.convex.dev/cli/reference/deploy ; `vercel integration guide convex`
- [partially] Fluid compute must be turned on for the project (PLAN.md L329).
  TRUTH: "As of April 23, 2025, fluid compute is enabled by default for new projects." No CLI flag exists; dashboard: Settings > Functions > Fluid Compute toggle, or per-deployment `fluid: true` in vercel.json / vercel.ts.
  SRC: https://vercel.com/docs/fluid-compute ; https://vercel.com/docs/project-configuration/vercel-ts (#fluid)
- [wrong] Workflows need project-level enablement / Vercel Queues must be provisioned manually.
  TRUTH: Workflow SDK deploying page: "When you deploy to Vercel, workflows automatically use the **Vercel World**, again with zero configuration." Vercel docs: "**Vercel Queues** enqueue and execute those routes with reliability" with no enablement step; Queues docs describe no provisioning step either (page carries a 'Permissions Required: Vercel Queues' badge only). Multi-region requires workflow >= 5.0.0-beta.33.
  SRC: https://workflow-sdk.dev/docs/deploying ; https://vercel.com/docs/workflows ; https://vercel.com/docs/queues
- [partially] `vercel link --yes --project <name>` links (and creates) the project.
  TRUTH: Docs: "The `--yes` option can be used to skip questions you are asked when setting up a new Vercel Project. The questions will be answered with the default scope and current directory for the Vercel Project name"; `--project` "allows you to set a project that does not match the name of the current working directory". 54.18.6 help: `--project` is "required for non-interactive existing-project links" and `--team` "use with --project for non-interactive links". Since 55.0.0 (changelog 2026-07-15): non-TTY link requires an explicit team (`--team`/`--scope`/VERCEL_ORG_ID) and "`--yes` ... answers confirmations without ever selecting a team for you"; otherwise `action_required: missing_scope`. Safe path: `vercel project add` then `vercel link --yes --scope <team> --project <name>`.
  SRC: https://vercel.com/docs/cli/link ; `vercel link --help` (54.18.6) ; https://vercel.com/changelog/faster-predictable-project-linking-in-the-vercel-cli
- [partially] Framework and build command can be set from the CLI with `vercel project update`.
  TRUTH: `vercel project update [name] --framework nextjs --build-command "..." [--install-command] [--output-directory] [--dev-command] [--auto-detect <setting>] [--format json]` requires CLI >= 54.21.1 (changelog 2026-07-08). The installed 54.18.6 `vercel project --help` lists no `update`. Node version is NOT a flag of project update: set it via package.json engines or dashboard. On 54.18.6 use vercel.ts `framework`/`buildCommand` (per-deployment override) or the dashboard, or `vercel upgrade`.
  SRC: https://vercel.com/docs/cli/project ; https://vercel.com/changelog/update-project-settings-from-the-vercel-cli ; `vercel project --help` (54.18.6)
- [wrong] `vercel env add NAME production preview development` adds to three environments (vendor env-vars and bootstrap skills).
  TRUTH: Signature is `vercel env add name [environment] [git-branch]`; a third positional is a Git branch (`vercel env add DB_PASS preview feat1`). On 54.18.6 run one command per environment (or omit the environment to target all three, which fails for development+sensitive policies). 56.2.0: "`vercel env add` now accepts a comma-separated list of environments" (`production,preview`). All versions: "If you select development with production or preview in the same command, `vercel env add` returns an error."
  SRC: https://vercel.com/docs/cli/env ; `vercel env add --help` (54.18.6) ; CHANGELOG 56.2.0 (github vercel/vercel packages/cli/CHANGELOG.md)
- [wrong] `vercel env add NAME preview --git-branch=staging` (vendor env-vars skill).
  TRUTH: Branch is positional for add: `vercel env add NAME preview staging`. `--git-branch` is a flag only on `vercel env pull` and `vercel env run`.
  SRC: https://vercel.com/docs/cli/env ; `vercel env add --help` ; `vercel env pull --help`
- [partially] `vercel env pull .env.local` replaces the whole file (vendor env-vars skill).
  TRUTH: True on 54.x. 56.0.0: "`vercel env pull` now keeps variables that only exist in the local env file". Usage: `vercel env pull .env.local --yes [--environment=preview] [--git-branch=<b>] [--id dpl_xxx]`; pulls Development vars by default.
  SRC: https://vercel.com/docs/cli/env ; `vercel env pull --help` ; CHANGELOG 56.0.0
- [partially] `vercel deploy --yes` = preview, `vercel deploy --prod --yes` = production.
  TRUTH: "The first deployment of a new project is always a **production** deployment. This happens even when you ... Run `vercel` or `vercel deploy` from the CLI without `--prod`". After that, `--prod` (= `--target=production`) is production and plain deploy is preview. stdout is always the deployment URL; `--dry [--format=json]` inspects detected framework/files; `--prebuilt --archive=tgz` after `vercel build`; `--skip-domain` with --prod. All present in 54.18.6.
  SRC: https://vercel.com/docs/cli/deploy ; https://vercel.com/docs/deployments/environments#first-deployment ; `vercel deploy --help` (54.18.6)
- [partially] The Convex marketplace integration provisions a Convex project and injects CONVEX_DEPLOYMENT, NEXT_PUBLIC_CONVEX_URL, CONVEX_DEPLOY_KEY.
  TRUTH: It creates a Convex project in a dedicated team ("Projects deployed with the Vercel marketplace will be a part of their own Convex team"; existing teams cannot use it) and "Connect your Convex project to a Vercel project to sync your Convex deploy keys to Vercel" (CONVEX_DEPLOY_KEY) - "you must enable the "Production" and "Preview" environments and you must keep the "Custom Prefix" field empty." NEXT_PUBLIC_CONVEX_URL is set at build by `npx convex deploy`; CONVEX_DEPLOYMENT is not injected. Build command must still be overridden unless scaffolded with `npm create convex@latest -- --with-vercel-json`. Local dev: `npx convex login --vercel` then `npx convex dev` choosing the marketplace project.
  SRC: `vercel integration guide convex` ; https://docs.convex.dev/production/hosting/vercel
- [wrong] The Clerk integration can enable Organizations from the Vercel CLI.
  TRUTH: No Vercel CLI flag enables Organizations; `enhanced-b2b-saas` is a paid add-on (org domain restrictions, auto-invitations, custom roles), not the Organizations toggle. Organizations are on the free plan ("Free plans include up to 50 MROs in development and 100 in production") and are enabled in the Clerk dashboard or with the Clerk CLI: `clerk enable orgs [--force-selection --max-members N]` (installed `clerk` CLI has `enable orgs|organizations` and `enable billing --for orgs`; Clerk docs: `npx clerk@latest enable orgs`). Requires a linked Clerk app (`clerk link` or `--app`).
  SRC: https://clerk.com/docs/guides/organizations/overview ; `clerk enable --help` ; `vercel integration add clerk --help`
- [partially] Integration CLI differs between 54.x and 59.x; upgrade required.
  TRUTH: 54.18.6 has the same subcommand set as the live docs (add, accept-terms, balance, categories, discover, guide, installations, list, open, resource {connect,disconnect,remove,create-threshold,claim}, update, remove). Later additions: 55.0.0 `integration resource inspect`; 56.0.0 auto-installs a product's agent skills after `integration add`. Upgrade is not required for provisioning.
  SRC: `vercel integration --help` (54.18.6) ; https://vercel.com/docs/cli/integration ; CHANGELOG 55.0.0, 56.0.0
- [unverifiable] Vercel CLI 59.0.0 major changes.
  TRUTH: Cannot be verified from any primary source: github.com/vercel/vercel has no `vercel@59*` tags (matching-refs), its packages/cli/CHANGELOG.md on main and its GitHub releases end at 58.4.4 (2026-07-30) although npm 59.x declares that repository; unpkg has no CHANGELOG; /docs/cli/release-notes renders no entries. The search-snippet claim that 59.x makes Node the default middleware runtime is CONTRADICTED by live docs ("Edge is the default runtime for Routing Middleware", updated 2026-08-14). Version dates (npm): 55.0.0 2026-07-09, 56.0.0 07-13, 56.2.0 07-14, 57.0.0 07-24, 58.0.0 07-27, 59.0.0 2026-08-13, 59.11.2 2026-09-02. At install time: `vercel upgrade --dry-run`, then diff `vercel link --help`, `vercel env add --help`, `vercel project --help` against this list.
  SRC: `gh api repos/vercel/vercel/git/matching-refs/tags/vercel@59` (empty) ; `gh api repos/vercel/vercel/contents/packages/cli/CHANGELOG.md?ref=main` (tops at 58.4.4) ; `npm view vercel time` ; https://vercel.com/docs/routing-middleware/getting-started
- [partially] Blob auth uses BLOB_READ_WRITE_TOKEN.
  TRUTH: "The SDK resolves credentials in this order": 1) explicit `token`; 2) OIDC: `oidcToken`/VERCEL_OIDC_TOKEN + `storeId`/BLOB_STORE_ID; 3) `process.env.BLOB_READ_WRITE_TOKEN`. Dashboard-created store adds only BLOB_READ_WRITE_TOKEN; connecting a store to a project adds BLOB_STORE_ID, VERCEL_OIDC_TOKEN, BLOB_WEBHOOK_PUBLIC_KEY. "`handleUpload` always requires a read-write token"; `handleUploadPresigned` is the OIDC-compatible client flow. Local OIDC tokens expire after 12 h and the SDK refreshes them via CLI credentials.
  SRC: https://vercel.com/docs/vercel-blob/using-blob-sdk (#authentication)
- [wrong] A Blob store is created from the CLI with `vercel blob store add <name>`.
  TRUTH: `vercel blob create-store [name] --access <public|private> [--region iad1] [--yes] [--environment <env>...]`; "Use `--yes` to auto-connect to the linked project (defaults to all environments)". Other store commands: get-store, list-stores [--all], delete-store, empty-store; file commands list/put/put-image/get/del/copy/signed-token/presign. Present in 54.18.6 (`vercel blob --help`).
  SRC: https://vercel.com/docs/cli/blob ; `vercel blob create-store --help` (54.18.6)
- [wrong] Vendor vercel-storage skill: `get(privateBlob.url)` reads a private blob.
  TRUTH: `get()` requires `access`: `get(urlOrPathname, { access: 'private' | 'public', token?, oidcToken?, storeId?, ifNoneMatch?, useCache? })`; returns null when not found.
  SRC: https://vercel.com/docs/vercel-blob/using-blob-sdk (#get)
- [wrong] Vendor bootstrap skill: `printf "%s" "$AUTH_SECRET" | vercel env add AUTH_SECRET development preview production` sets three envs.
  TRUTH: Parsed as environment=development, git-branch=preview, extra arg -> error; and development cannot be combined with other targets. Use three separate `vercel env add` calls (or `production,preview` on >=56.2.0 plus a separate development call).
  SRC: `vercel env add --help` ; https://vercel.com/docs/cli/env
- [partially] Vendor marketplace skill: env vars are injected into all three environments automatically.
  TRUTH: Default is all three (`-e` "Defaults to all"), but Convex only syncs deploy keys into Production and Preview, and Clerk maps dev instance -> development+preview, prod instance -> production. Use `-e production -e preview` for Convex.
  SRC: `vercel integration add --help` ; `vercel integration guide convex` ; Clerk marketplace docs
- [partially] Vercel Queues need separate provisioning/quota on Hobby.
  TRUTH: No enablement step is documented; Queues is "the lower-level primitive that powers Vercel Workflows", billed per API operation in 4 KiB chunks at regional rates (limits: TTL 60s-7d default 24h, max message 100 MB, unlimited topics/consumer groups). Workflows pricing page: "Vercel bills Queues usage at standard rates". Plan availability on Hobby is not stated on the page; confirm on first deploy.
  SRC: https://vercel.com/docs/queues ; https://vercel.com/docs/queues/pricing ; https://vercel.com/docs/workflows/pricing

## CONFIRMED FACTS
- Build command on Vercel is `npx convex deploy --cmd 'pnpm build'`; production and preview Convex deploy keys are separate (CLAUDE.md L30, PLAN.md L329). → Convex docs: "Override the "Build command" to be `npx convex deploy --cmd 'npm run build'`" (any build command after --cmd). Production key: "Create an environment variable named `CONVEX_DEPLOY_KEY` ... uncheck all except *Production*"; Preview key: "Generate 
- Hobby includes 50k workflow events a month (PLAN.md L329). → Table: Workflow Events "50,000 events / month included" ($0.02 per 1K on demand); Workflow Data Written 1 GB ($0.50/GB); Workflow Data Retained not on Hobby; retention after run completion 1 day Hobby / 7 days Pro / 30 days Enterprise. Rate limit 100,000 reque
- Workflow run limits: 10,000 steps, 25,000 events, 240s max replay, 50 MB payload, no maximum duration (PLAN.md L325). → Events per run 25,000; Steps per run 10,000; Max payload size 50 MB; Max workflow replay duration 240s; Maximum run duration No limit; Maximum sleep duration No limit; max total entity storage per run 2 GB; hook token 255 bytes; run creations 1,000/s.
- Node 24 is the Vercel default (CLAUDE.md L13). → "By default, a new project uses the latest Node.js LTS version available on Vercel": 24.x (default), 22.x, 20.x. Override via dashboard Settings > Build and Deployment > Node.js Version, or package.json `"engines": {"node": "24.x"}` which overrides the dashboa
- Fluid max duration defaults. → Default / Max duration: Hobby 300s / 300s; Pro and Enterprise 300s / 800s; extended 1800s beta (Pro/Enterprise, set per function). Precedence: function code > vercel.json(.ts) > dashboard > Fluid defaults. Vendor vercel-functions skill's "10s Hobby" is legacy 
- A Vercel project can be created non-interactively with `vercel project add <name>`. → "Create a new project. The `name` argument is required; `vercel project add` with no name ... prints a usage error". Present in 54.18.6 (`vercel project add --help`). Use `--scope <team>` to pick the team.
- `vercel env add NAME production < file` and stdin piping work non-interactively. → `vercel env add API_URL production < url.txt`, `cat file | vercel env add NAME preview`, or `vercel env add API_TOKEN production --value "<value>" --yes`. `--force` overwrites the same target. Production/preview default to `sensitive` (`--no-sensitive` to opt 
- `vercel git connect` connects the GitHub repo non-interactively. → `vercel git connect [git-url] --yes`: "Vercel CLI searches for a local `.git` config file containing at least one remote URL"; `--yes` skips the connect confirmation. Prerequisite (browser, once): Vercel for GitHub App installed with repo access; personal repo
- Convex is installable via `vercel integration add convex` / `vercel install convex`. → `vercel install` "(alias for `integration add`)", also `vc i`. Product slug `convex` (discover output). Plans printed by `vercel integration add convex --help`: `CONVEX_BASE` (Free), `CONVEX_STARTER_PLUS` (Starter), `CONVEX_PROFESSIONAL` (Professional). Metada
- Clerk native integration creates a Clerk app and injects NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY. → "Vercel will automatically provision a Clerk account, Organization, and application for you." Synced: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY; "Clerk's development instance maps to Vercel's development and preview environments, and the productio
- Resend exists on the Marketplace and injects RESEND_API_KEY. → Native product slug `resend/resend-email` (discover); installs with `vercel integration add resend`. Plans from `--help`: `free` (0.00), `pro` ($20/mo), `scale` ($90/mo) - the marketplace page's "Pro plans available from $20" omits the free plan the CLI lists.
- Which marketplace steps need an interactive browser/TTY. → `accept-terms` "requires an interactive terminal and human confirmation" (first install of an integration on a team); vendor skill adds the CLI may open a browser for terms and poll. `add` "detects non-interactive terminals and skips interactive prompts" so pa
- Known breaking changes 55-58. → 55.0.0 Major: "Require an explicit team signal when linking without a TTY", "`--yes` no longer selects a team on its own". 56.0.0 Major: `vercel routes export` uses `--output`; Minor: env pull keeps local-only vars, marketplace agent skills auto-installed, `oa
- @vercel/blob put() signature and access modes (PLAN.md L384). → `put(pathname, body, options)`; "most SDK methods require you to pass `access: 'private'` or `access: 'public'`". Options: addRandomSuffix (default false, "We recommend using this option"), allowOverwrite, cacheControlMaxAge, contentType, token, oidcToken, sto
- Client upload vs server upload for Blob. → Server: `put()` from '@vercel/blob'. Browser: `upload(pathname, body, { access, handleUploadUrl, clientPayload?, multipart? })` from '@vercel/blob/client' against a route calling `handleUpload({ body, request, onBeforeGenerateToken, onUploadCompleted, token? }
- vercel.ts with @vercel/config/v1 supports buildCommand, framework, functions.maxDuration, crons. → `import { routes, deploymentEnv, type VercelConfig } from '@vercel/config/v1'; export const config: VercelConfig = {...}`. Keys: buildCommand, bunVersion, cleanUrls, crons, devCommand, fluid, framework, functions (runtime, maxDuration, supportsCancellation, in
- vercel.ts is honoured by CLI 54 or only 59+. → Supported by the installed 54.18.6: its bundle (dist/chunks/chunk-EFUR47FZ.js) contains the `vercel.ts` filename and `@vercel/config/v1` strings; the feature shipped 2025-12-19 and docs state no minimum CLI version. It "executes at build time". Confirm with `v
- How vercel.ts coexists with dashboard settings. → "Use only one configuration file: `vercel.ts` or `vercel.json`." buildCommand "overrides the Build Command in Project Settings ... for a given deployment"; same for framework, installCommand, outputDirectory, devCommand, ignoreCommand. Fluid precedence: code >
- Preview deployments with Convex use a preview deploy key and --preview-run. → Preview Deploy Key scoped to Preview only as CONVEX_DEPLOY_KEY; "`npx convex deploy` will read `CONVEX_DEPLOY_KEY` from the environment, and use it to create a Convex deployment associated with the Git branch name"; `--preview-run 'functionName'` "will only be
- Current account context. → `vercel whoami` = sonnysangha; teams: sonnysanghas-projects (selected) and sonnysangha-s-youtube-team; no `papaflow` project on page 1 of `vercel project ls`; `gh` is authenticated as sonnysangha; `clerk` CLI is installed with `enable orgs`/`enable billing` an

## SNIPPETS
### vercel.ts (@vercel/config 0.7.0; works on CLI 54.18.6)
```
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: "npx convex deploy --cmd 'pnpm build'",
  fluid: true, // already the default for new projects
  functions: {
    'app/api/**/route.ts': { maxDuration: 300 }, // memory NOT settable under Fluid
  },
  // crons: [{ path: '/api/cleanup', schedule: '0 0 * * *' }],
};
// Use only one of vercel.ts / vercel.json. Overrides dashboard settings per deployment.
```
### package.json Node 24 pin (overrides dashboard)
```
{
  "engines": { "node": "24.x" }
}
```
### Blob server upload (OIDC by default)
```
import { put } from '@vercel/blob';

const blob = await put(`images/${runId}.png`, bytes, {
  access: 'public',          // required: 'public' | 'private'
  addRandomSuffix: true,
  contentType: 'image/png',
});
// blob.url -> https://<store>.public.blob.vercel-storage.com/...
// auth order: token option > VERCEL_OIDC_TOKEN+BLOB_STORE_ID > BLOB_READ_WRITE_TOKEN
```
### Blob private read
```
import { get } from '@vercel/blob';
const res = await get(url, { access: 'private' }); // null if not found
// res.stream (ReadableStream) + metadata; ifNoneMatch -> statusCode 304
```
### Blob client upload route (needs BLOB_READ_WRITE_TOKEN; OIDC-only -> handleUploadPresigned)
```
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const json = await handleUpload({
    body, request,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      // authenticate/authorize the user here
      return { addRandomSuffix: true, allowedContentTypes: ['image/*'] };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {},
  });
  return Response.json(json);
}
// client: upload(name, file, { access: 'public', handleUploadUrl: '/api/upload' }) from '@vercel/blob/client'
```
### Vercel env vars per environment (Convex)
```
# Production only
CONVEX_DEPLOY_KEY=<Production Deploy Key>
# Preview only
CONVEX_DEPLOY_KEY=<Preview Deploy Key>
# Do NOT set NEXT_PUBLIC_CONVEX_URL or CONVEX_DEPLOYMENT in Vercel; `npx convex deploy` writes the URL during the build.
# Build command (prod + preview): npx convex deploy --cmd 'pnpm build'
# Optional preview seeding:      npx convex deploy --cmd 'pnpm build' --preview-run 'seed'
# If the URL var name cannot be inferred: --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```
### Env vars injected by marketplace integrations
```
# clerk  (slug clerk, plan hobby_2025_08)          -> NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY (dev instance: development+preview; prod instance: production)
# convex (slug convex, plan CONVEX_BASE)           -> CONVEX_DEPLOY_KEY (prod key on Production, preview key on Preview; keep Custom Prefix empty)
# resend (slug resend/resend-email, plan free)     -> RESEND_API_KEY   (metadata domain= and region= are REQUIRED)
# blob (vercel blob create-store --yes)            -> BLOB_STORE_ID, VERCEL_OIDC_TOKEN, BLOB_WEBHOOK_PUBLIC_KEY ; dashboard-created store -> BLOB_READ_WRITE_TOKEN
```
### next.config.ts wrappers
```
import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {};
export default withWorkflow(nextConfig); // plan: withWorkflow(withEve(nextConfig)); Vercel World is selected automatically on deploy
```
### vercel env add signature (54.18.6 and later)
```
vercel env add <name> [production|preview|development] [git-branch] [--value <v>] [--yes] [--force] [--sensitive|--no-sensitive]
# 56.2.0+: vercel env add <name> production,preview --value <v> --yes
# development must always be its own command
```
