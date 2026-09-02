# verify:convex

## SUMMARY
Versions (npm, 2026-09-02): convex@1.45.0 (node>=20; published 2026-08-21), svix@2.2.0 (engines node>=22), convex-test@0.0.56 (peer convex ^1.43), @edge-runtime/vm@5.0.0, convex-helpers@0.1.123. ~/.convex/config.json holds {accessToken}, so the CLI is logged in.

Provisioning (corrected): the team slug IS discoverable from the CLI: `npx convex login status` prints "Teams: N teams accessible" then "  - <name> (<slug>)" (login.ts). Then `npx convex dev --once --configure new --team <slug> --project papaflow --dev-deployment cloud`. `dev` has no --yes. Headless caveat verified in source: when stdin is not a TTY the base selection is "anonymous" even if logged in, but `--configure new` (chosenConfiguration !== null) routes to handleChooseProject -> ensureLoggedIn -> cloud project creation, so the command above is safe; a plain `npx convex dev --once` with no .env.local in a non-TTY shell silently creates a LOCAL anonymous deployment (guard with CONVEX_ALLOW_ANONYMOUS=false). Newer alternatives exist: `npx convex project create <name> --team <slug>` and `npx convex deployment create [ref] --type dev|prod --select`. dev writes .env.local (CONVEX_DEPLOYMENT=dev:<name>, NEXT_PUBLIC_CONVEX_URL for Next.js) and convex/README.md + tsconfig.json (skipped if present); zero modules only logs "No non-'use node' modules found." - write schema.ts first anyway.

Clerk: auth.config.ts uses process.env (Convex doc: CLERK_JWT_ISSUER_DOMAIN; Clerk doc: CLERK_FRONTEND_API_URL) with applicationID "convex"; set via `npx convex env set`. ConvexProviderWithClerk from "convex/react-clerk" ({client,useAuth}); getToken() without template when sessionClaims.aud==="convex"; re-fetches on [orgId, orgRole, sessionId]. Clerk v2 tokens carry `o` {id,slg,rol,per,fpm}, `pla` ("scope:planslug"), `fea`; legacy org_id/org_role are gone. Convex OIDC path stringifies each non-standard top-level claim; whether the runtime re-parses nested objects could not be located - add top-level org_id/org_role claims and log identity once.

Webhook: httpRouter + httpAction, await request.text(), svix Webhook.verify(payload,{svix-id,svix-timestamp,svix-signature}) returns undefined at v2.2.0 (the Convex demo's cast would yield undefined) - JSON.parse the raw body after verify.

ConvexHttpClient ("convex/browser"): mutation(api.x.y,args); setAdminAuth is @internal; no documented app-facing server auth; shared-secret public mutation is consistent with best-practices.

Vercel: build `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`; prod key = deployment settings, preview key = project settings (dashboard only; `deployment token create` cannot mint preview keys). Marketplace "Vercel Native" integration: `npx convex login --vercel`, syncs deploy keys, build override still manual.

Testing: vitest environment "edge-runtime"; convexTest(schema, import.meta.glob("./**/*.ts")); both finishInProgressScheduledFunctions and finishAllScheduledFunctions exist; no cron support.

## VERSIONS
{
"convex": "1.45.0",
"svix": "2.2.0",
"convex-test": "0.0.56",
"@edge-runtime/vm": "5.0.0",
"convex-helpers": "0.1.123"
}

## COMMANDS
- npx convex login status   # prints 'Teams: N teams accessible' and '  - <name> (<slug>)' per team; no --json; use this to get --team
- npx convex dev --once --configure new --team <team-slug> --project papaflow --dev-deployment cloud   # creates project + cloud dev deployment, writes .env.local and convex/README.md + tsconfig.json; --configure overrides the non-TTY anonymous branch
- CONVEX_ALLOW_ANONYMOUS=false npx convex dev --once   # later pushes; the env var prevents a silent LOCAL anonymous deployment if .env.local is ever missing in a non-TTY shell
- npx convex dev --until-success
- npx convex dev --once --run <module:fn>
- npx convex project create papaflow --team <team-slug>   # alternative: project only, then `npx convex deployment create dev/main --type dev --select`; confirm `--help` at install time
- npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<verb-noun-00>.clerk.accounts.dev
- npx convex env set CLERK_WEBHOOK_SIGNING_SECRET whsec_...
- npx convex env set ENGINE_SECRET <random-32-bytes>
- npx convex env set "NAME=value"   # NAME=VALUE form; needed when the value starts with '-'
- npx convex env set --prod NAME value
- npx convex env set --from-file .env.convex [--force]
- npx convex env list [--names-only] [--prod]
- npx convex env get NAME
- npx convex env remove NAME   # aliases rm, unset
- npx convex env default set NAME value --type preview   # project-level defaults for new dev/preview/prod deployments
- npx convex run <module>:<fn> '{"a":1}' [--prod] [--push] [--identity '{"subject":"user_1","issuer":"https://x.clerk.accounts.dev"}'] [--watch]
- npx convex logs [--prod] [--history 100] [--success] [--jsonl] [--deployment <name|dev|prod|local>]
- npx convex dashboard [--prod] [--no-open]
- npx convex function-spec   # dump public/internal function signatures (used by MCP functionSpec)
- npx convex deployment token create <name> [--prod] [--deployment <ref>] [--save-env [.env.local]]   # dev/prod deploy key only; cannot mint preview keys; fails if CONVEX_DEPLOY_KEY is set
- MANUAL: Convex Dashboard > production deployment > Deployment Settings > General > Generate Production Deploy Key (deployment:deploy) -> Vercel env CONVEX_DEPLOY_KEY, Environment = Production only
- MANUAL: Convex Dashboard > Project Settings > Generate Preview Deploy Key -> Vercel env CONVEX_DEPLOY_KEY, Environment = Preview only
- MANUAL: Vercel > Settings > Build Command override: npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
- npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
- npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --preview-run 'seed:preview'   # --preview-run only fires with a preview key
- npx convex deploy -y --dry-run
- npx convex login --vercel   # hidden flag 'Redirect to Vercel SSO integration for login'; only needed for the Marketplace (Vercel Native) path
- MANUAL: Vercel Marketplace 'Convex' (Vercel Native): creates a Convex project in a dedicated team, syncs deploy keys to the Vercel project (Production + Preview); build command override still required
- pnpm add convex svix
- pnpm add -D convex-test vitest @edge-runtime/vm
- CONVEX_AGENT_MODE=anonymous npx convex dev --once   # forces a local anonymous deployment (no account); not what PapaFlow wants for its cloud dev deployment

## NON-CONFIRMED FACTS (11 of 45)
- [wrong] npx convex dev accepts --yes
  TRUTH: No -y/--yes on dev. '-y, --yes' ('Skip confirmation prompt when running interactively. Warning: this deploys to PRODUCTION') is in addDeployOptions and is used by deploy, run (with --push) and import.
  SRC: dev.ts and https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/cli/lib/command.ts
- [wrong] How to discover the team slug from the CLI
  TRUTH: The researcher said no CLI path exists. `npx convex login status` ('Check login status and list accessible teams') prints 'Status: Logged in', 'Teams: N teams accessible' and one line per team '  - <name> (<slug>)'; no --json, no TTY check. Fallback: dashboard URL https://dashboard.convex.dev/t/<team-slug>.
  SRC: https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/cli/login.ts (status subcommand); https://docs.convex.dev/cli (lists login status in 1.44 changelog fix)
- [partially] Headless behaviour: logged in but stdin is not a TTY
  TRUTH: deploymentSelection.ts: with no CONVEX_DEPLOY_KEY/CONVEX_DEPLOYMENT, `(!isLoggedIn || CONVEX_AGENT_MODE==='anonymous' || !process.stdin.isTTY) && !implicitProd && shouldAllowAnonymousDevelopment()` => kind 'anonymous' (local), EVEN WHEN LOGGED IN. configure.ts: `if (chosenConfiguration !== null || promptYesNo(...)) return handleChooseProject(...)` which calls ensureLoggedIn and selectNewProject -> so `--configure new --team --project --dev-deployment cloud` creates a CLOUD project non-interactively. Without --configure and without .env.local, a non-TTY `npx convex dev --once` silently creates a local anonymous deployment; CONVEX_ALLOW_ANONYMOUS=false disables that branch (shouldAllowAnonymousDevelopment).
  SRC: https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/cli/lib/deploymentSelection.ts; https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/cli/configure.ts
- [partially] npx convex dev --once errors when convex/ is empty
  TRUTH: For a new project doInitConvexFolder (lib/codegen.ts) writes convex/README.md and convex/tsconfig.json (both skipped if they exist). With zero modules the bundler logs "No non-'use node' modules found." and no error path was found in config.ts; the push appears to proceed. Still write convex/schema.ts before the first --once to get a real push and _generated/ output.
  SRC: https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/cli/lib/codegen.ts; lib/config.ts
- [partially] Clerk org/plan claims on the identity (top-level pass-through vs nested o)
  TRUTH: Clerk v2 session tokens carry `o` {id, slg, rol, per, fpm}, `pla` ('scope:planslug') and `fea`; legacy org_id/org_role/org_slug were removed with v1 (deprecated 2025-04-14). Convex keybroker (OIDC path) does `custom_claims.insert(claim.0.to_string(), claim.1.to_string())` for every non-standard top-level claim (serde_json::Value::to_string => JSON text); dot-flattening exists only for customJwt. Whether the runtime JSON-parses those strings back into objects could not be located in source. Do as PLAN.md 331 says: add top-level custom claims org_id: {{org.id}}, org_role: {{org.role}} (keep total under ~1.2KB) and log the identity once in dev.
  SRC: https://clerk.com/docs/guides/sessions/session-tokens; https://raw.githubusercontent.com/get-convex/convex-backend/main/crates/keybroker/src/broker.rs
- [wrong] svix verify returns the parsed event
  TRUTH: At tag v2.2.0: `constructor(secret: string | Uint8Array, options?: WebhookOptions)`; `verify(payload: string | Buffer, headers_: WebhookRequiredHeaders | WebhookUnbrandedRequiredHeaders | Record<string,string>): undefined` - delegates to standardwebhooks with { jsonParse: false } and throws WebhookVerificationError. The Convex demo's `wh.verify(...) as unknown as WebhookEvent` yields undefined at runtime with svix 2.x; parse `JSON.parse(payloadString)` yourself after verify.
  SRC: https://raw.githubusercontent.com/svix/svix-webhooks/v2.2.0/javascript/src/webhook.ts (verified at the release tag, not main)
- [partially] Convex documents a shared-secret public-mutation pattern for trusted servers
  TRUTH: Not named as an official pattern. Best-practices: 'Public functions can be called by anyone ... should be carefully audited'; access checks must use getUserIdentity or 'a function argument that is unguessable'. A public mutation checking args.secret === process.env.ENGINE_SECRET (unguessable argument) then calling a shared helper/internal mutation satisfies that guidance. Alternative documented path: a customJwt provider ({type:'customJwt', issuer, jwks, algorithm:'RS256'|'ES256', applicationID}) lets the engine mint its own JWT and call ConvexHttpClient.setAuth(); nested claims arrive dot-flattened. No app-facing deploy/admin-key server auth is documented (deploy keys are CLI/CI).
  SRC: https://docs.convex.dev/understanding/best-practices; https://docs.convex.dev/auth/advanced/custom-jwt; https://docs.convex.dev/cli/deploy-key-types
- [partially] Deploy keys are dashboard-only
  TRUTH: Prod and preview keys: dashboard. CLI: `npx convex deployment token create <name> [--prod] [--deployment <ref>] [--save-env [path]]` mints a deployment-scoped dev/prod deploy key (requires login; refuses when CONVEX_DEPLOY_KEY is set) and 'does not support preview keys'; `deployment token delete <nameOrToken>`. A 'project token' type (project:<team>:<project>|...) that can create dev/prod deployments also exists (generation location not verified).
  SRC: https://docs.convex.dev/cli/reference/deployment; https://docs.convex.dev/cli/deploy-key-types
- [wrong] Convex MCP tools in this session can create a project
  TRUTH: Plugin runs `npx -y convex@latest mcp start`; tools status(projectDir) ('Get all available deployments for a given Convex project directory' - needs an already configured project), envList/envGet/envSet/envRemove, tables, data, run, runOneoffQuery, functionSpec, insights, logs, all keyed by a deploymentSelector from status. None creates a project or deployment.
  SRC: ToolSearch schema of mcp__plugin_convex_convex__status/envSet; /Users/sonnysangha/.claude/plugins/cache/claude-plugins-official/convex/1.10.0/.mcp.json
- [partially] Local plugin skills drift vs live docs
  TRUTH: quickstart/design: CONVEX_AGENT_MODE=anonymous confirmed in deploymentSelection.ts; their claim '--configure new does not bypass the team prompt' is wrong when --team is given (validateOrSelectTeam) and --configure does bypass the anonymous branch. env skill: 'process.env only in actions' contradicts docs. auth skill targets @convex-dev/auth (not Clerk). workflow skill is @convex-dev/workflow (not Vercel Workflow). test skill's finishInProgressScheduledFunctions is valid (docs list it). design skill's typed env export matches docs (convex>=1.39).
  SRC: /Users/sonnysangha/.claude/plugins/cache/claude-plugins-official/convex/1.10.0/skills/*/SKILL.md vs docs cited above
- [unverifiable] svix runs inside the Convex runtime for httpAction
  TRUTH: Convex's own demo imports svix in convex/http.ts (non-Node runtime), so it bundles; svix@2.2.0 declares engines node>=22, which is only an npm warning. Confirm the first `npx convex dev --once` push succeeds with `import { Webhook } from "svix"` in http.ts; fall back to `standardwebhooks` if the bundle fails.
  SRC: https://raw.githubusercontent.com/get-convex/convex-demos/main/users-and-clerk-webhooks/convex/http.ts; npm view svix engines

## CONFIRMED FACTS
- Current convex npm version and Node requirement → convex@1.45.0 (dist-tag latest, published 2026-08-21; alpha 1.45.0-alpha.0), engines node >=20.0.0 npm >=7; peerDeps react ^18||^19, @clerk/clerk-react ^4.12.8||^5, @clerk/react ^6.4.3, @auth0/auth0-react ^2.0.1
- svix, convex-test, @edge-runtime/vm, convex-helpers versions → svix@2.2.0 (engines node >=22; dist-tag next=2.0.0-rc.2), convex-test@0.0.56 (peer convex ^1.43.0), @edge-runtime/vm@5.0.0, convex-helpers@0.1.123
- npx convex dev supports --once, --configure new, --project, --team, --dev-deployment cloud|local → dev.ts options: --once, --until-success, --configure [new|existing] (conflicts --url/--admin-key/--env-file), --team <team_slug>, --project <project_slug>, --dev-deployment <cloud|local> (conflicts --prod), --prod, --run <functionName>, --run-component, --star
- How --team and --project are resolved with --configure new → validateOrSelectTeam(ctx, teamSlug, 'Team:'): with --team validates against GET /teams ('Error: Team <slug> not found, fix the --team option or remove it'); one team auto-selected; several teams prompt (fails in non-TTY with 'Cannot prompt for input in non-int
- Newer CLI commands can create projects/deployments without `dev` → `npx convex project create <name> [--team <team_slug>]` ('Defaults to your only team, or prompts when you belong to several'; name required non-interactively) creates a project only; `npx convex deployment create [reference] --type <dev|prod> [--region] [--sel
- npx convex dev writes .env.local with CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL and creates convex/ → writeDeploymentEnvVar writes `CONVEX_DEPLOYMENT=<type>:<name>` (e.g. dev:tall-forest-1234) preceded by "# Deployment used by `npx convex dev`" with inline 'team: X, project: Y', and adds .env.local to .gitignore; writeUrlsToEnvFile({convexUrl, siteUrl}) writes
- Non-interactive auth uses a saved access token in ~/.convex/config.json → ~/.convex/config.json shape { accessToken } (present locally, keys ['accessToken']). Precedence: --url/--admin-key > CONVEX_DEPLOY_KEY (preview:/project:/deployment keys) > CONVEX_SELF_HOSTED_URL+ADMIN_KEY > CONVEX_DEPLOYMENT from .env.local/.env > anonymous (
- convex/auth.config.ts for Clerk → import { AuthConfig } from "convex/server"; export default { providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }] } satisfies AuthConfig; Clerk's guide uses `npx convex env set CLERK_FRONTEND_API_URL '{{fapi_url}}'` and proces
- auth.config.ts can read process.env → Both Convex and Clerk official guides ship auth.config.ts reading process.env.<VAR>!, configured with the deployment's env vars.
- Clerk native Convex integration: session token carries aud 'convex', no JWT template needed → Clerk: 'select Activate Convex integration. This will reveal the Frontend API URL for your Clerk instance', aud pre-mapped. ConvexProviderWithClerk: if sessionClaims?.aud === "convex" -> getToken({ skipCache: forceRefreshToken }), else getToken({ template: "co
- ConvexProviderWithClerk import path, props, App Router placement → import { ConvexProviderWithClerk } from "convex/react-clerk"; props { children, client: IConvexReactClient, useAuth: UseAuth } with useAuth from @clerk/nextjs; 'It must be wrapped by a configured ClerkProvider'; Clerk: '<ClerkProvider> wraps <ConvexClientProvi
- ConvexProviderWithClerk re-authenticates when the active org changes → fetchAccessToken useCallback deps are [orgId, orgRole, sessionId]; an org switch yields a new token and re-runs subscribed queries.
- Authenticated/Unauthenticated/AuthLoading helpers exist → <Authenticated>, <Unauthenticated>, <AuthLoading>, <AuthRefreshing> from "convex/react"; use useConvexAuth() for auth state on the Convex side.
- ctx.auth.getUserIdentity() returns tokenIdentifier, subject, issuer → Guaranteed tokenIdentifier/subject/issuer; OIDC fields (name, givenName, familyName, nickname, preferredUsername, profile, pictureUrl, email, emailVerified, updatedAt, ...) become named fields; jti, nbf and Clerk's fva are dropped; other top-level claims pass 
- httpAction in convex/http.ts with httpRouter, served on https://<deployment>.convex.site → import { httpRouter } from "convex/server"; import { httpAction } from "./_generated/server"; http.route({ path, method: "POST", handler }); pathPrefix supported; 'HTTP actions are exposed at https://<your deployment name>.convex.site'; bodies via .text()/.jso
- Clerk webhook verified with svix; secret in a Convex env var → Official demo/doc: route '/clerk-users-webhook', headers svix-id/svix-timestamp/svix-signature, new Webhook(process.env.CLERK_WEBHOOK_SECRET!).verify(payloadString, svixHeaders), Clerk endpoint https://<deployment name>.convex.site/clerk-users-webhook (note .s
- Calling internal mutations from an httpAction via ctx.runMutation(internal.x.y) → import { internal } from "./_generated/api"; await ctx.runMutation(internal.module.fn, args); internalQuery/internalMutation/internalAction from ./_generated/server; best-practices: every ctx.runQuery/runMutation/runAction should target internal.* not api.*.
- ConvexHttpClient from convex/browser works in Node with .mutation(api.x.y, args) → import { ConvexHttpClient } from "convex/browser"; new ConvexHttpClient(address, { skipConvexDeploymentUrlCheck?, logger?, auth?, fetch? }); setAuth(token)/clearAuth()/query()/mutation()/action()/consistentQuery() (experimental); POSTs /api/query, /api/mutatio
- ConvexHttpClient cannot call internal functions; setAdminAuth is internal → setAdminAuth(token, actingAsIdentity?) is @internal ('Set admin auth token to allow calling internal queries, mutations, and actions'; header 'Convex <adminKey>'). Docs: 'You cannot call internal functions from outside of your Convex deployment.'
- process.env is readable in Convex functions (including mutations) → 'You can access environment variables in Convex functions using process.env.KEY. If the variable is set it is a string, otherwise it is undefined.' Typed `env` export from ./_generated/server after declaring in convex/convex.config.ts defineApp({ env: {...} })
- npx convex env set NAME value and --prod → env set NAME 'value' | env set NAME=value | env set --from-file .env [--force] | env get NAME | env list [--names-only] | env remove|rm|unset NAME; targeting --prod or --deployment <name|ref>; `env default set|get|list|remove --type dev|preview|prod [--project
- Schema DSL: defineSchema, defineTable, v.* validators, .index(name, fields), Id<'table'> → import { defineSchema, defineTable } from "convex/server"; import { v } from "convex/values"; v.id(table), v.null(), v.int64() (BigInt), v.number(), v.boolean(), v.string() (<1MB), v.bytes(), v.array(values) (<=8192), v.object({}) (<=1024 entries), v.record(ke
- Index naming convention by_<field> and compound index rules → Name unique per table; fields ordered; _creationTime 'is added to all indexes automatically'; reserved by_id and by_creation_time; up to 16 fields per index, 32 indexes per table, no duplicate or _-prefixed fields; query 'must step through fields in index orde
- Function syntax with args and returns validators → export const send = mutation({ args: { body: v.string() }, returns: v.null(), handler: async (ctx, args) => {...} }); same for query/action/internal*; best-practices: every public function has argument validators.
- ctx.scheduler.runAfter / runAt and convex/crons.ts → ctx.scheduler.runAfter(delayMs, fnRef, args) / runAt(tsMs, fnRef, args) / cancel(id). crons: import { cronJobs } from "convex/server"; const crons = cronJobs(); crons.interval(id, { seconds|minutes|hours }, fn, args?); crons.cron(id, '5-field cron', fn, args?)
- Vercel build command with separate prod and preview CONVEX_DEPLOY_KEY → Override Build Command to `npx convex deploy --cmd 'npm run build'` (pnpm build works). Production key: Deployment Settings > General > Generate Production Deploy Key (deployment:deploy), Vercel env CONVEX_DEPLOY_KEY scoped Production only (prod:<name>|...). P
- npx convex deploy flags including --preview-run → --cmd <command>, --cmd-url-env-var-name <name>, --preview-run <functionName>, --preview-name <name>, --preview-create <name>, --dry-run, --typecheck <enable|try|disable> (default try), --typecheck-components, --codegen <enable|disable>, -y/--yes, --env-file, -
- Convex Vercel Marketplace integration exists → 'Convex for Vercel' listing (Vercel Native, 'Free plans available', install `vc i convex` / `vercel integration add convex`). Steps: `npx convex login --vercel` (hidden login flag: 'Redirect to Vercel SSO integration for login'), create/choose a project in the
- convex-test + vitest config uses environment edge-runtime; modules via import.meta.glob → npm install --save-dev convex-test vitest @edge-runtime/vm; vitest.config.ts test.environment = "edge-runtime"; convexTest(schema, import.meta.glob("./**/*.ts")) or "./**/!(*.*.*)*.*s" when convex/ is relocated via convex.json; t.withIdentity({...any attribute
- npx convex run / logs / dashboard flags → run [functionName] [args] -w/--watch --push --prod --identity '<UserIdentity JSON>' --typecheck --codegen --component <path> --deployment <d> --inline-query <js> (-y with --push); logs --history [n] --success --jsonl --prod --deployment; dashboard|dash --no-op
- PLAN.md 331 / 435: claims pass-through verified from source; log identity once → Correct and necessary (see Clerk claims fact): top-level custom claims pass through; nested `o` handling is not documented for OIDC. Use explicit org_id/org_role claims.
- PLAN.md 321 / CLAUDE.md rule 5: shared-secret public mutation, never setAdminAuth → setAdminAuth is @internal; 'internal functions can't be called from outside' is documented; secret-checked public mutation calling a shared helper is consistent with best-practices ('unguessable' argument). ENGINE_SECRET lives in both the Convex deployment (np
- CLAUDE.md rule 12 / KICKOFF: every table indexed by orgId → `.index("by_org", ["orgId"])` per table, compound `.index("by_org_and_status", ["orgId", "status"])`; max 32 indexes/table.
- CLAUDE.md Commands: `pnpm convex:dev` = npx convex dev; build `npx convex deploy --cmd 'pnpm build'` → Both valid; add `--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` to the build command for certainty, and run convex dev with CONVEX_ALLOW_ANONYMOUS=false in scripts so a missing .env.local never yields a silent local deployment.

## SNIPPETS
### Non-interactive project + cloud dev deployment creation (uses ~/.convex/config.json access token)
```
# 0) discover the team slug (prints '  - <name> (<slug>)' per team)
npx convex login status
# 1) create project + cloud dev deployment, push once, write .env.local
#    (--configure new bypasses the non-TTY anonymous branch; --team/--project avoid prompts)
npx convex dev --once --configure new --team <team-slug> --project papaflow --dev-deployment cloud
# writes .env.local:
#   # Deployment used by `npx convex dev`
#   CONVEX_DEPLOYMENT=dev:<adjective-animal-123> # team: <slug>, project: papaflow
#   NEXT_PUBLIC_CONVEX_URL=https://<adjective-animal-123>.convex.cloud
# and convex/README.md + convex/tsconfig.json (skipped if present)
# 2) secrets on the dev deployment
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<verb-noun-00>.clerk.accounts.dev
npx convex env set CLERK_WEBHOOK_SIGNING_SECRET whsec_xxx
npx convex env set ENGINE_SECRET <random>
# 3) later pushes (guard against silent local anonymous deployment if .env.local goes missing)
CONVEX_ALLOW_ANONYMOUS=false npx convex dev --once
```
### convex/auth.config.ts (Clerk, native integration)
```
import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, // Clerk Frontend API URL, set with `npx convex env set`
      applicationID: "convex",                      // must equal the session token's aud
    },
  ],
} satisfies AuthConfig;
```
### app/ConvexClientProvider.tsx + layout wiring
```
"use client";
import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

// app/layout.tsx (server component): ClerkProvider MUST wrap ConvexClientProvider
// <ClerkProvider><ConvexClientProvider>{children}</ConvexClientProvider></ClerkProvider>
// helpers: import { Authenticated, Unauthenticated, AuthLoading, AuthRefreshing, useConvexAuth } from "convex/react";
```
### convex/http.ts Clerk webhook skeleton (svix 2.x: verify returns undefined)
```
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { WebhookEvent } from "@clerk/backend";
import { Webhook } from "svix";

const http = httpRouter();

http.route({
  path: "/clerk-webhook", // Clerk endpoint: https://<deployment>.convex.site/clerk-webhook (.site, not .cloud)
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.text(); // raw body first
    const headers = {
      "svix-id": request.headers.get("svix-id")!,
      "svix-timestamp": request.headers.get("svix-timestamp")!,
      "svix-signature": request.headers.get("svix-signature")!,
    };
    try {
      new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET!).verify(payload, headers); // throws WebhookVerificationError
    } catch {
      return new Response("invalid signature", { status: 400 });
    }
    const event = JSON.parse(payload) as WebhookEvent; // verify() returns undefined in svix 2.x
    if (event.type.startsWith("organization.")) {
      await ctx.runMutation(internal.clerk.upsertOrganization, { data: event.data });
    }
    return new Response(null, { status: 200 });
  }),
});

export default http;
```
### convex/schema.ts excerpt with org index
```
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  connections: defineTable({
    orgId: v.string(),
    createdBy: v.string(),
    provider: v.string(),
    kind: v.union(v.literal("apiKey"), v.literal("oauth2"), v.literal("webhookUrl"), v.literal("botToken")),
    label: v.string(),
    secret: v.object({ v: v.literal(1), keyId: v.string(), iv: v.string(), tag: v.string(), ct: v.string() }),
    hint: v.string(),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    meta: v.optional(v.record(v.string(), v.any())),
    status: v.union(v.literal("active"), v.literal("needs_reconnect"), v.literal("revoked")),
    requiresFeature: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])                      // _creationTime appended automatically
    .index("by_org_and_provider", ["orgId", "provider"]),
});
// import { Id, Doc } from "./_generated/dataModel";  Id<"connections">
```
### Shared-secret mutation for the engine (public + internal share a helper)
```
// convex/steps.ts
import { v } from "convex/values";
import { mutation, internalMutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

async function markHelper(ctx: MutationCtx, a: { stepId: Id<"steps">; status: string }) {
  await ctx.db.patch(a.stepId, { status: a.status });
}

export const markFromEngine = mutation({
  args: { secret: v.string(), stepId: v.id("steps"), status: v.string() },
  returns: v.null(),
  handler: async (ctx, { secret, ...rest }) => {
    if (secret !== process.env.ENGINE_SECRET) throw new Error("unauthorized"); // unguessable argument = allowed access check
    await markHelper(ctx, rest);
    return null;
  },
});

export const mark = internalMutation({ args: { stepId: v.id("steps"), status: v.string() }, handler: markHelper });

// workflows/steps/run-node.ts ("use step", Node)
// import { ConvexHttpClient } from "convex/browser"; import { api } from "@/convex/_generated/api";
// const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
// await convex.mutation(api.steps.markFromEngine, { secret: process.env.ENGINE_SECRET!, stepId, status: "success" });
```
### Reading identity + org claims in a Convex function
```
import { QueryCtx } from "./_generated/server";

export async function requireOrg(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity(); // null when unauthenticated (throws in httpAction)
  if (!identity) throw new Error("unauthenticated");
  // Clerk v2 tokens: nested `o` {id,slg,rol,per,fpm}, `pla`, `fea`; add top-level custom claims in Clerk's
  // session-token customizer: org_id: {{org.id}}, org_role: {{org.role}} - then:
  const orgId = identity.org_id as string | undefined;
  const orgRole = identity.org_role as string | undefined;
  if (!orgId) { console.log("identity", JSON.stringify(identity)); throw new Error("no active org"); } // log once in dev
  return { userId: identity.subject, orgId, orgRole };
}
```
### vitest.config.ts + convex-test usage
```
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "edge-runtime" } });

// convex/test.setup.ts
export const modules = import.meta.glob("./**/*.ts"); // or "./**/!(*.*.*)*.*s" if convex/ is relocated via convex.json

// convex/steps.test.ts
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { modules } from "./test.setup";

test("engine secret + webhook signature", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "user_1", issuer: "https://x.clerk.accounts.dev", org_id: "org_1" });
  await expect(t.mutation(api.steps.markFromEngine, { secret: "bad", stepId: "x" as any, status: "ok" })).rejects.toThrow();
  const res = await t.fetch("/clerk-webhook", { method: "POST", body: "{}" });
  expect(res.status).toBe(400);
  // scheduled fns: vi.useFakeTimers(); ...; vi.advanceTimersByTime(11000); await t.finishInProgressScheduledFunctions(); vi.useRealTimers();
});
```
### convex/crons.ts + scheduler
```
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("usage sweep", { hours: 1 }, internal.usage.sweep, {});
crons.daily("nightly rollup", { hourUTC: 3, minuteUTC: 17 }, internal.usage.rollup, {}); // UTC; avoid :00
export default crons;

// inside a mutation/action:
// const id = await ctx.scheduler.runAfter(60_000, internal.connections.refresh, { connectionId });
// await ctx.scheduler.runAt(Date.now() + 5 * 60_000, internal.x.y, args); await ctx.scheduler.cancel(id);
```
### Vercel deploy settings
```
# Vercel > Settings > Build Command (pass the URL var name explicitly)
npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
# optional, only runs when deploying with a preview key:
npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --preview-run 'seed:preview'

# Vercel env vars
CONVEX_DEPLOY_KEY = prod:<deployment>|...        # Production scope only (Dashboard > Deployment Settings > General)
CONVEX_DEPLOY_KEY = preview:<team>:<project>|...  # Preview scope only (Dashboard > Project Settings)
ENGINE_SECRET, CREDENTIALS_KEK, CLERK_*           # app secrets; NEXT_PUBLIC_CONVEX_URL is injected into --cmd by convex deploy
```
### Typed env (optional, convex >= 1.39) incl. CONVEX_SITE_URL for the webhook URL
```
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
const app = defineApp({
  env: { CLERK_JWT_ISSUER_DOMAIN: v.string(), CLERK_WEBHOOK_SIGNING_SECRET: v.string(), ENGINE_SECRET: v.string() },
});
export default app;
// then: import { env } from "./_generated/server"; env.ENGINE_SECRET; env.CONVEX_SITE_URL (1.44+) = https://<deployment>.convex.site
```
