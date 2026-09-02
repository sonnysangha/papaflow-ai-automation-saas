# verify:versions

## SUMMARY
All version numbers below were re-read from `npm view` on 2026-09-02 (per-version `time[<v>]`, not `time.modified`). Stable pins: next 16.3.4 (2026-08-31), react/react-dom 19.2.8, convex 1.45.0, @clerk/nextjs 7.8.4 + @clerk/backend 3.17.0 (2026-09-01), @xyflow/react 12.11.6, zod 4.5.4, ai 7.0.90 (v7 IS latest; 7.0.0 shipped 2026-06-25; ai-v6/ai-v5 tags exist for old lines), eve 0.49.0 (2026-09-02 01:47Z; engines node >=24; peer ai ^7.0.82; no `workflow` dependency at all), @ai-sdk/workflow 2.0.21 (peer workflow ^5.0.0-beta.42, hard dep ai 7.0.90), @openrouter/ai-sdk-provider 3.0.0 (peer ai ^7.0.0).

`workflow`: latest 4.8.5 (2026-08-25); beta 5.0.0-beta.47 (2026-08-31); no stable 5.0.0 on npm despite workflow-sdk.dev wording. The docs' "workflow@5 beta line" is correct; 5.x is required only for @ai-sdk/workflow 2.x and multi-region.

Peer checks pass for the core: @clerk/nextjs peers next `^16.1.0-0` and react `~19.2.3`; convex peers react `^19.0.0` and @clerk/react `^6.4.3`; @xyflow/react peers react >=17; ai 7 + all @ai-sdk/* + openrouter peer zod `^3.25.76 || ^4.1.8`; convex has no zod peer.

Corrections to the first pass: (1) `@clerk/themes` 2.4.57 is a Core-2 package (depends on @clerk/shared ^3.47.2 while @clerk/nextjs 7 uses @clerk/shared ^4.30.2); Clerk's current Next.js theme docs use `@clerk/ui` 1.31.0 with `import { dark } from '@clerk/ui/themes'` and `appearance={{ theme: dark }}`. Do not install @clerk/themes. (2) eslint 10.9.1 is NOT safe: eslint-config-next 16.3.4 pulls eslint-plugin-react 7.37.5 (peer eslint `^9.7` max), eslint-plugin-import 2.32.0 and jsx-a11y 6.10.2 (peer `^9`); create-next-app 16.3.4 scaffolds `eslint: "^9"`. Pin eslint 9.39.5. (3) lucide-react 1.x breaking changes are brand-icon removal and UMD removal, not icon renames; 1.0.0 was unintentional, 1.39.0 is fine. (4) The convex-test docs config has no `server.deps.inline`; drop it. (5) svix 2.2.0 removed JSON parsing from `Webhook.verify()`; simpler: Clerk's own `verifyWebhook(request, { signingSecret })` from `@clerk/backend/webhooks` (dual CJS/ESM, uses standardwebhooks) removes svix from the Convex httpAction entirely.

TypeScript: npm latest is 7.0.2 (no JS API); typescript-eslint 8.69.0 peers `>=4.8.4 <6.1.0`, so pin typescript 6.0.3 (create-next-app still writes `^5`). Node: local 24.14.1, Vercel default 24.x; set `"engines": {"node": "24.x"}`; @types/node 24.13.3.

ESM-only (no `require` export): ai, all @ai-sdk/*, @openrouter/ai-sdk-provider, eve, @clerk/ui, svix, workflow runtime (`.`/`./api` have no CJS runtime; `workflow/next` is a .cjs), vitest node entry, convex-test, shadcn, vite-tsconfig-paths, typescript 7. Dual: convex, zod, @clerk/nextjs, @clerk/backend, @xyflow/react, lucide-react, resend, croner, @vercel/blob, @vercel/functions, sonner, tailwind-merge, cva, clsx. cron-parser is CJS.

## VERSIONS
{
"next": "16.3.4",
"react": "19.2.8",
"react-dom": "19.2.8",
"typescript": "6.0.3",
"tailwindcss": "4.3.3",
"@tailwindcss/postcss": "4.3.3",
"convex": "1.45.0",
"@clerk/nextjs": "7.8.4",
"@clerk/backend": "3.17.0",
"@clerk/themes": "2.4.57 (DO NOT INSTALL - Core 2 line; use @clerk/ui instead)",
"@clerk/ui": "1.31.0",
"@xyflow/react": "12.11.6",
"zod": "4.5.4",
"ai": "7.0.90",
"@ai-sdk/openai": "4.0.56",
"@ai-sdk/anthropic": "4.0.48",
"@ai-sdk/google": "4.0.62",
"@ai-sdk/xai": "4.0.53",
"@ai-sdk/mistral": "4.0.39",
"@ai-sdk/groq": "4.0.37",
"@ai-sdk/deepseek": "3.0.39",
"@ai-sdk/elevenlabs": "3.0.37",
"@ai-sdk/fal": "3.0.37",
"@ai-sdk/mcp": "2.0.43",
"@ai-sdk/workflow": "2.0.21",
"@ai-sdk/gateway": "4.0.72",
"@openrouter/ai-sdk-provider": "3.0.0",
"workflow": "5.0.0-beta.47",
"eve": "0.49.0",
"@vercel/config": "0.7.0",
"@vercel/functions": "3.9.5",
"@vercel/blob": "2.8.0",
"svix": "2.2.0",
"resend": "6.25.0",
"cron-parser": "5.10.0",
"croner": "10.0.1",
"vitest": "4.1.11",
"convex-test": "0.0.56",
"@edge-runtime/vm": "5.0.0",
"shadcn": "4.20.0",
"lucide-react": "1.39.0",
"sonner": "2.0.8",
"class-variance-authority": "0.7.1",
"tailwind-merge": "3.6.0",
"clsx": "2.1.1",
"create-next-app": "16.3.4",
"eslint": "9.39.5",
"eslint-config-next": "16.3.4",
"@types/node": "24.13.3",
"@types/react": "19.2.18",
"@types/react-dom": "19.2.5",
"vite-tsconfig-paths": "6.1.1"
}

## COMMANDS
- npm view workflow dist-tags --json
- npm view workflow 'time[5.0.0-beta.47]' 'time[4.8.5]'
- npm view eve version dist-tags engines peerDependencies peerDependenciesMeta dependencies exports --json
- npm view ai dist-tags engines peerDependencies exports --json
- npm view @ai-sdk/workflow@2.0.21 peerDependencies dependencies --json
- npm view @clerk/nextjs@7.8.4 peerDependencies dependencies engines exports --json
- npm view @clerk/ui version peerDependencies dependencies exports --json
- npm view @clerk/themes@2.4.57 dependencies --json   # shows @clerk/shared ^3.x = Core 2 line, do not install
- npm view convex@1.45.0 peerDependencies peerDependenciesMeta engines exports --json
- npm view typescript dist-tags --json
- npm view typescript-eslint peerDependencies --json
- npm view eslint-config-next@16.3.4 dependencies peerDependencies --json
- npm view eslint-plugin-react eslint-plugin-import eslint-plugin-jsx-a11y peerDependencies --json   # none accept eslint 10
- npm view svix@2.2.0 type exports engines dependencies --json
- npm view vitest dist-tags engines peerDependencies --json
- npm view convex-test peerDependencies type --json
- node --version   # 24.14.1 locally; eve needs >=24
- pnpm add next@16.3.4 react@19.2.8 react-dom@19.2.8 convex@1.45.0 @clerk/nextjs@7.8.4 @clerk/backend@3.17.0 @clerk/ui@1.31.0 @xyflow/react@12.11.6 zod@4.5.4 ai@7.0.90 @ai-sdk/openai@4.0.56 @ai-sdk/anthropic@4.0.48 @ai-sdk/google@4.0.62 @ai-sdk/xai@4.0.53 @ai-sdk/mistral@4.0.39 @ai-sdk/groq@4.0.37 @ai-sdk/deepseek@3.0.39 @ai-sdk/elevenlabs@3.0.37 @ai-sdk/fal@3.0.37 @ai-sdk/mcp@2.0.43 @openrouter/ai-sdk-provider@3.0.0 resend@6.25.0 croner@10.0.1 lucide-react@1.39.0 sonner@2.0.8 class-variance-authority@0.7.1 tailwind-merge@3.6.0 clsx@2.1.1
- pnpm add -D typescript@6.0.3 @types/node@24.13.3 @types/react@19.2.18 @types/react-dom@19.2.5 tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 eslint@9.39.5 eslint-config-next@16.3.4 vitest@4.1.11 convex-test@0.0.56 @edge-runtime/vm@5.0.0 vite-tsconfig-paths@6.1.1
- pnpm add workflow@5.0.0-beta.47   # Phase 2; workflow@4.8.5 is the stable alternative if @ai-sdk/workflow and multi-region are not needed
- pnpm add eve@0.49.0   # Phase 10; Node >=24 locally, engines.node 24.x on Vercel; never eve@beta (stale 0.6.0-beta.20)
- pnpm add @ai-sdk/workflow@2.0.21   # only for Fallback B (WorkflowAgent); requires workflow 5 beta and ai 7.0.90 exactly
- pnpm add svix@2.2.0   # optional: only if you verify Clerk webhooks with svix instead of @clerk/backend/webhooks verifyWebhook
- MANUAL: Vercel project Settings > Build and Deployment > Node.js Version = 24.x (or rely on "engines": {"node": "24.x"} in package.json, which overrides the setting)

## NON-CONFIRMED FACTS (6 of 28)
- [wrong] eve pins specific ai / workflow versions that conflict with latest.
  TRUTH: eve 0.49.0 has NO dependency or peer on the `workflow` npm package. dependencies: nitro 3.0.260610-beta, undici 8.9.0. peerDependencies: ai "^7.0.82" (required; 7.0.90 satisfies), @opentelemetry/api ^1.0.0, braintrust ^3.0.0, just-bash ^3.1.0, microsandbox ^0.5.0 - the latter four are optional per peerDependenciesMeta. eve ships its own `./workflow` and `./tools/workflow` subpaths.
  SRC: npm view eve@0.49.0 dependencies peerDependencies peerDependenciesMeta exports --json
- [partially] `typescript` can be installed at latest for `tsc --noEmit` (CLAUDE.md line 25).
  TRUTH: npm latest typescript = 7.0.2 (2026-07-08, Go port, "type": "module", exports "." -> ./lib/version.cjs only; no JS compiler API - the TS blog: "TypeScript 7.0 does not ship with an API"). Next 16.3 docs: "Next.js uses the project-local `tsc` CLI by default" (experimental.useTypeScriptCli); Convex docs: "Both TypeScript 6 and TypeScript 7 are supported, and Convex typechecks with the `tsc` binary installed in your project". BUT typescript-eslint 8.69.0 (latest; pulled by eslint-config-next 16.3.4 via "typescript-eslint": "^8.46.0") peers typescript ">=4.8.4 <6.1.0", so TS 7 breaks lint. create-next-app itself still writes typescript ^5 (resolves 5.9.3). Pin typescript 6.0.3 (latest 6.x, 2026-04-16). Optional side-by-side layout from the TS blog: "typescript": "npm:@typescript/typescript6@^6.0.2" + "@typescript/native": "npm:typescript@^7.0.2" (@typescript/typescript6 latest is 6.0.2; @typescript/native is only an alias name, not a registry package).
  SRC: npm view typescript dist-tags exports type --json; npm view typescript time[6.0.3]; npm view typescript-eslint peerDependencies dist-tags --json; npm view eslint-config-next@16.3.4 dependencies --json; npm view @typescript/typescript6 dist-tags --json; https://nextjs.org/docs/app/api-reference/config/typescript; https://docs.convex.dev/understanding/best-practices/typescript; https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- [wrong] eslint latest (10.x) works with eslint-config-next.
  TRUTH: eslint-config-next 16.3.4 itself peers eslint ">=9.0.0" and typescript-eslint peers eslint "^8.57.0 || ^9.0.0 || ^10.0.0", BUT eslint-config-next's own dependencies do not accept eslint 10: eslint-plugin-react 7.37.5 peers eslint "^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7", eslint-plugin-import 2.32.0 peers "... || ^8 || ^9", eslint-plugin-jsx-a11y 6.10.2 peers "... || ^8 || ^9" (only eslint-plugin-react-hooks 7.1.1 accepts ^10). create-next-app 16.3.4 scaffolds `"eslint": "^9"`. Pin eslint 9.39.5 (latest 9.x) to avoid unmet-peer errors/warnings; eslint 10.9.1 is CJS, engines ^20.19.0 || ^22.13.0 || >=24.
  SRC: npm view eslint-config-next@16.3.4 peerDependencies dependencies --json; npm view eslint-plugin-react peerDependencies --json; npm view eslint-plugin-import peerDependencies --json; npm view eslint-plugin-jsx-a11y peerDependencies --json; npm view eslint@9 version --json; https://raw.githubusercontent.com/vercel/next.js/v16.3.4/packages/create-next-app/templates/index.ts
- [partially] Clerk webhook on a Convex httpAction is verified with `svix` (CLAUDE.md line 92).
  TRUTH: svix latest 2.2.0 (2026-08-31T16:09Z): ESM-only ("type": "module", exports "." -> ./dist/index.mjs; changelog 2.0.0: "Drop support for CommonJS"), engines node >=22, single dep standardwebhooks ^1.1.1 (CJS, pure-JS deps fast-sha256 + @stablelib/base64, so it should bundle into Convex's default runtime without "use node" - confirm at install). Changelog 2.2.0: "Remove JSON parsing from `Webhook.verify`, for consistency with SDKs for other languages" (2.0.0/2.1.0 were yanked over this). The Convex docs example `wh.verify(payloadString, svixHeaders) as unknown as WebhookEvent` (env CLERK_WEBHOOK_SECRET) is therefore stale: call verify() then JSON.parse the raw body - or skip svix and use `verifyWebhook` from `@clerk/backend/webhooks`, which @clerk/backend 3.17.0 already brings in.
  SRC: npm view svix@2.2.0 type exports engines dependencies --json; npm view standardwebhooks dependencies type --json; https://raw.githubusercontent.com/svix/svix-webhooks/main/ChangeLog.md; https://docs.convex.dev/auth/database-auth; https://clerk.com/docs/reference/backend/verify-webhook
- [wrong] @clerk/themes should be pinned at latest (2.4.57).
  TRUTH: @clerk/themes 2.4.57 (latest tag, published 2026-02-27) depends on @clerk/shared ^3.47.2 - the Core 2 line - whereas @clerk/nextjs 7.8.4 / @clerk/react 6.14.8 depend on @clerk/shared ^4.30.2; installing it duplicates @clerk/shared and it is not what Clerk's Core 3 docs use. Clerk's current Next.js themes page says `npm install @clerk/ui`, `import { dark } from '@clerk/ui/themes'`, passed as `appearance={{ theme: dark }}` (key is `theme`, not `baseTheme`); shadcn theme note: "This theme is compatible with Tailwind CSS v4 usage". @clerk/ui latest = 1.31.0 (2026-08-28), ESM-only, peers react "^18.0.0 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0", deps @clerk/shared ^4.30.2, exports ./themes. Pin @clerk/ui 1.31.0 instead of @clerk/themes. (The Core 3 upgrade guide URL returned 404; verify the `theme` key against @clerk/ui types at install.)
  SRC: npm view @clerk/themes@2.4.57 dependencies --json; npm view @clerk/themes dist-tags --json; npm view @clerk/ui version dist-tags peerDependencies dependencies exports type --json; https://clerk.com/docs/nextjs/guides/customizing-clerk/appearance-prop/themes; https://clerk.com/docs/nextjs/getting-started/quickstart
- [partially] lucide-react for shadcn icons; 1.x may have renamed icons.
  TRUTH: lucide-react latest 1.39.0 (2026-09-01), peer react "^16.5.1 || ^17.0.0 || ^18.0.0 || ^19.0.0", dual (main dist/cjs, module dist/esm .mjs). 1.0.0 (2026-03-23) page says "This release was published unintentionally. We've corrected this in v1.0.1, which should be used instead." The v1 breaking changes listed in 1.0.1 are: brand icons removed, UMD build removed ("only ESM and CJS now"), lucide-vue-next renamed to @lucide/vue, `aria-hidden` set by default. No icon renames are listed - the first researcher's rename warning is unsupported. Any 1.x >= 1.0.1 is fine; 1.39.0 is safe.
  SRC: npm view lucide-react version peerDependencies main module --json; https://github.com/lucide-icons/lucide/releases/tag/1.0.0; https://github.com/lucide-icons/lucide/releases/tag/1.0.1

## CONFIRMED FACTS
- Vercel Workflows is on the `workflow@5` beta line (CLAUDE.md line 12; PLAN.md line 329 `npm i workflow@beta`). → npm dist-tags: latest = 4.8.5 (published 2026-08-25T15:27Z), beta = 5.0.0-beta.47 (2026-08-31T23:37Z). No 5.0.0 stable exists on npm. workflow-sdk.dev/worlds/vercel says "Multi-region support is available starting with `workflow` version 5.0.0" and "On the 4.x
- @ai-sdk/workflow (Fallback B, PLAN.md line 345) needs workflow 5 beta. → @ai-sdk/workflow 2.0.21 (2026-09-02T03:15Z) peerDependencies: workflow "^5.0.0-beta.42", zod "^3.25.76 || ^4.1.8"; dependencies pin ai "7.0.90" exactly (so pin ai 7.0.90 to avoid two copies). README install line: `npm install @ai-sdk/workflow ai workflow@beta`
- eve is beta, Node 24+, versions daily; pin it (CLAUDE.md line 13, PLAN.md lines 343/432). → eve latest = 0.49.0 (2026-09-02T01:47Z); 0.48.0 on 2026-09-01, 0.47.0 on 2026-08-27. engines.node ">=24". eve.dev/docs: "Node.js 24 or newer"; manual install `npm install eve@latest ai zod`; scaffold `npx eve@latest init my-agent`. README: "eve is currently a 
- AI SDK 7 is the current major and ESM-only, Node 22+ (CLAUDE.md lines 14, 83). → ai latest = 7.0.90 (2026-09-02T03:17Z); 7.0.0 shipped 2026-06-25T12:47Z. Other tags: ai-v6 6.0.275, ai-v5 5.0.251, beta 7.0.0-beta.187 (2026-06-24, older than latest), canary 7.0.0-canary.176. "type": "module", exports carry only types/import/default (no requi
- ai v7 wants zod ^4 or ^3; what does convex want? → ai 7.0.90, all @ai-sdk/* and @openrouter/ai-sdk-provider peer zod "^3.25.76 || ^4.1.8". convex 1.45.0 declares no zod peer (its deps are ws 8.21.0, esbuild 0.27.0, prettier ^3). zod latest 4.5.4 (2026-08-29), dual CJS/ESM with ./v3, ./v4, ./mini subpaths. @wor
- @openrouter/ai-sdk-provider needs confirming for the v7 peer dep (PLAN.md line 94). → 3.0.0 (latest, 2026-07-06) peerDependencies: ai "^7.0.0", zod "^3.25.76 || ^4.1.8"; ESM-only, node >=22. README: "This release line supports `ai@^7.0.0`, requires Node.js 22 or newer, and is ESM-only"; legacy lines: 2.9.1 for ai v6, 1.5.4 for ai v5. README's d
- @clerk/nextjs supports the current Next major and React. → @clerk/nextjs 7.8.4 (2026-09-01T17:57Z) peer next: "^15.2.8 || ^15.3.8 || ^15.4.10 || ^15.5.9 || ^15.6.0-0 || ^16.0.10 || ^16.1.0-0" (16.3.4 ok); react/react-dom "^18.0.0 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0" (19.2.8 ok). deps: @clerk/backend ^3.17.0,
- Pin @clerk/nextjs and @clerk/backend (CLAUDE.md line 17). → @clerk/nextjs 7.8.4 and @clerk/backend 3.17.0 (2026-09-01T17:58Z). @clerk/backend is dual CJS/ESM, exports ./webhooks and ./jwt, depends on standardwebhooks ^1.0.0. Clerk docs: `import { verifyWebhook } from '@clerk/backend/webhooks'`, signature `verifyWebhook
- convex peer range includes the current react major. → convex 1.45.0 (2026-08-21) peerDependencies: react "^18.0.0 || ^19.0.0-0 || ^19.0.0", @clerk/react "^6.4.3", @clerk/clerk-react "^4.12.8 || ^5.0.0", @auth0/auth0-react "^2.0.1" - ALL optional per peerDependenciesMeta (no pnpm warnings). engines node >=20.0.0, 
- @xyflow/react v12 supports current React (CLAUDE.md line 15). → @xyflow/react 12.11.6 (2026-09-01T12:07Z) peers react >=17, react-dom >=17, @types/react >=17, @types/react-dom >=17. Dual: esm (index.mjs/index.js) + umd for require. Pin @types/react-dom 19.2.5 (peer @types/react ^19.2.0) to satisfy its peer.
- Next.js latest for the scaffold. → next 16.3.4 (2026-08-31T20:00Z), engines node >=20.9.0, peer react/react-dom "^18.2.0 || ^19.0.0" (sass, @playwright/test, @opentelemetry/api, babel-plugin-react-compiler are optional peers). canary = 16.4.0-canary.14 (2026-09-01); `beta` (16.0.0-beta.0), `rc`
- Vercel runs Node 24 so eve's engines requirement is satisfiable. → Vercel docs: "Current available versions are: 24.x (default), 22.x, 20.x"; "You can define the major Node.js version in the `engines#node` section of the `package.json` to override the one you have selected in the Project Settings" (`"engines": {"node": "24.x"
- eve integrates into Next via withEve (CLAUDE.md line 22, PLAN.md line 329). → eve 0.49.0 exports "./next" with import/default conditions only (no require). eve.dev Next.js guide: `npm install eve@latest`; `import { withEve } from "eve/next"; export default withEve(nextConfig);` in next.config.ts; agent mounted at `/eve/v1/*` (named agen
- vitest + convex-test + @edge-runtime/vm for tests (CLAUDE.md line 27). → vitest 4.1.11 (2026-08-18; rc 5.0.0-rc.4 and beta 5.0.0-beta.7 exist, not stable), engines ^20 || ^22 || >=24, peers (all optional-style) @edge-runtime/vm "*", @types/node ^20||^22||>=24, vite ^6||^7||^8. Vitest docs list built-in environments node, jsdom, hap
- shadcn CLI and UI deps. → shadcn 4.20.0 (2026-09-02T12:04Z, ESM-only, engines node >=20.18.1, exports ./mcp, ./registry, ./preset, ./tailwind.css); tailwindcss 4.3.3 and @tailwindcss/postcss 4.3.3 (2026-07-16, no peers/engines declared); sonner 2.0.8 (2026-08-09, dual, peers react ^18|
- Resend for app-owned email. → resend 6.25.0 (2026-08-28), engines node >=20, dual CJS/ESM (index.mjs + index.cjs), peer @react-email/render "*" (optional).
- Cron parsing libraries for the Schedule trigger. → cron-parser 5.10.0 (2026-08-14) is CommonJS ("type": "commonjs", main dist/index.js, no exports map, node >=18). croner 10.0.1 (2026-02-01) is dual ("type": "module", exports import ./dist/croner.js + require ./dist/croner.cjs, node >=18). Both work inside "us
- Vercel helper packages. → @vercel/config 0.7.0 (2026-08-27); @vercel/functions 3.9.5 (2026-08-20, engines node >= 20, same file for import/require, peers ws >=8 and @aws-sdk/credential-provider-web-identity - check peerDependenciesMeta at install); @vercel/blob 2.8.0 (2026-08-10, "type
- workflow package module format for bundling/tests; `npx workflow web` exists. → workflow 4.8.5 and 5.0.0-beta.47 are "type": "module", no engines field. exports ".": types + default -> dist/index.js, "require" -> dist/typescript-plugin.cjs (the TS plugin, NOT the runtime API), "workflow" condition -> dist/workflow.js (5 beta adds a "node"
- @ai-sdk/mcp is the MCP client package (CLAUDE.md line 83). → @ai-sdk/mcp 2.0.43 (2026-09-02T03:17Z), ESM-only, node >=22, exports "." and "./mcp-stdio", peer zod ^3.25.76 || ^4.1.8.
- All @ai-sdk provider packages named in PLAN.md lines 87-96 exist at compatible versions. → Latest on 2026-09-02: @ai-sdk/openai 4.0.56, @ai-sdk/anthropic 4.0.48, @ai-sdk/google 4.0.62, @ai-sdk/xai 4.0.53, @ai-sdk/mistral 4.0.39, @ai-sdk/groq 4.0.37, @ai-sdk/deepseek 3.0.39, @ai-sdk/elevenlabs 3.0.37, @ai-sdk/fal 3.0.37, @ai-sdk/gateway 4.0.72. All: 
- Which packages are ESM-only (matters for vitest / Convex bundling / next.config). → No `require` entry in exports: ai, every @ai-sdk/*, @openrouter/ai-sdk-provider, eve (all subpaths incl. eve/next), @clerk/ui, svix (index.mjs only), shadcn, vite-tsconfig-paths, convex-test, typescript 7, workflow runtime (`workflow`, `workflow/api`, `workflo

## SNIPPETS
### package.json engines + toolchain pins (TS 6 keeps typescript-eslint working; eslint 9 satisfies eslint-config-next's plugin peers)
```
{
  "engines": { "node": "24.x" },
  "devDependencies": {
    "typescript": "6.0.3",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.4",
    "@types/node": "24.13.3",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5"
  }
}
```
### Optional side-by-side TS 6 + TS 7 layout (verbatim from the TypeScript 7.0 announcement; Next 16.3 and Convex >=1.43 use the local tsc binary)
```
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
// `tsc` -> TS 7 native binary; `tsc6` + JS API -> TS 6 for typescript-eslint
```
### Clerk webhook in a Convex httpAction without svix (@clerk/backend 3.17.0, dual CJS/ESM)
```
import { httpAction } from "./_generated/server";
import { verifyWebhook } from "@clerk/backend/webhooks";

export const clerkWebhook = httpAction(async (ctx, request) => {
  let event;
  try {
    event = await verifyWebhook(request, {
      signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    }); // Promise<WebhookEvent>, throws on bad signature
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
  // event.type: "organization.created" | "organizationMembership.created" | "subscription.updated" ...
  return new Response(null, { status: 200 });
});
```
### svix 2.2.0 verify (if you keep svix): verify() no longer returns the parsed body
```
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";

const payloadString = await req.text();
new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET!).verify(payloadString, {
  "svix-id": req.headers.get("svix-id")!,
  "svix-timestamp": req.headers.get("svix-timestamp")!,
  "svix-signature": req.headers.get("svix-signature")!,
}); // throws on failure; returns nothing useful in 2.2.0
const event = JSON.parse(payloadString) as WebhookEvent;
```
### vitest.config.ts for convex-test (Vitest 4 `projects`, verbatim shape from docs.convex.dev/testing/convex-test)
```
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      { extends: true, test: { name: "convex", include: ["convex/**/*.test.{ts,js}"], environment: "edge-runtime" } },
      { extends: true, test: { name: "unit", include: ["**/*.test.{ts,tsx}"], exclude: ["convex/**"], environment: "node" } },
    ],
  },
});
```
### next.config.mts composing workflow + eve (eve/next is ESM-only; .mts avoids the CJS-only next.config.ts resolution on Node 22.18+/24)
```
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};
export default withWorkflow(withEve(nextConfig));
```
### Clerk Core 3 theme via @clerk/ui (replaces @clerk/themes)
```
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";

<ClerkProvider appearance={{ theme: dark }}>{children}</ClerkProvider>
```
### Peer ranges that matter (verbatim from npm, 2026-09-02)
```
@clerk/nextjs@7.8.4   next: ^15.2.8 || ^15.3.8 || ^15.4.10 || ^15.5.9 || ^15.6.0-0 || ^16.0.10 || ^16.1.0-0
@clerk/nextjs@7.8.4   react: ^18.0.0 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0
convex@1.45.0         react: ^18.0.0 || ^19.0.0-0 || ^19.0.0 ; @clerk/react: ^6.4.3 (all optional)
ai@7.0.90             zod: ^3.25.76 || ^4.1.8 ; engines node >=22
eve@0.49.0            ai: ^7.0.82 ; engines node >=24 ; no workflow dep
@ai-sdk/workflow@2.0.21  workflow: ^5.0.0-beta.42 ; depends ai 7.0.90
@openrouter/ai-sdk-provider@3.0.0  ai: ^7.0.0
typescript-eslint@8.69.0  typescript: >=4.8.4 <6.1.0 ; eslint: ^8.57.0 || ^9.0.0 || ^10.0.0
eslint-plugin-react@7.37.5  eslint: ^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7   (blocks eslint 10)
convex-test@0.0.56    convex: ^1.43.0
@xyflow/react@12.11.6 react/react-dom/@types/react/@types/react-dom: >=17
```
