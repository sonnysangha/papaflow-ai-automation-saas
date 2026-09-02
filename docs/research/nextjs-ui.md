# verify:nextjs-ui

## SUMMARY
Next.js latest is 16.3.4 (Node >=20.9; template pins react/react-dom 19.2.8 exactly, typescript ^5, tailwindcss ^4 + @tailwindcss/postcss ^4, eslint ^9). Turbopack is the default for `next dev`/`next build`; webpack opt-in is only `next dev --webpack` (no `bundler:` next.config key exists; the vendor turbopack skill's `bundler: 'webpack'` / `BUNDLER=webpack` are drift). create-next-app 16.3.4 has NO `--turbopack`/`--webpack` options (only `--rspack`; `.allowUnknownOption()` swallows them silently). `pnpm create next-app@16.3.4 . --yes --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm` scaffolds into the current directory: appName = basename(resolve('.')) = "n8n-clone-demo", which validate-npm-package-name accepts. The folder must be empty except an allowlist (.git, .gitignore, .claude, .vscode, docs, LICENSE...); CLAUDE.md is NOT allowed and aborts, so copy CLAUDE.md in after scaffolding (the generated CLAUDE.md is just "@AGENTS.md" and is written with writeFileSync, unconditionally; use `--no-agents-md` to skip it). `next build` no longer lints. middleware.ts is renamed proxy.ts in v16: export named `proxy` or default, `export const config = { matcher }` (NOT `proxyConfig` — the vendor nextjs skill is wrong), Node runtime only, `runtime` export throws. Clerk: `export default clerkMiddleware()` in proxy.ts; `createRouteMatcher()` deprecated. `cacheComponents: true` is top-level, opt-in, replaces experimental.ppr; leave it off for this auth-gated app. `serverExternalPackages` top-level (stable 15.0); `after` from 'next/server' (stable 15.1); webhooks read `await request.text()`; `RouteContext<'/path'>` global after typegen.

shadcn CLI 4.20.0: Base UI is the default base since July 2026 (`-b radix` for Radix; Radix not deprecated). `init -d` = `--template=next --preset=base-nova` and skips all prompts (`-y` defaults true); `--style/--base-color/--src-dir` are removed. components.json `style` is now `"base-nova"` or `"radix-nova"` (schema enum, not "new-york"); extra keys `iconLibrary`, `menuColor`, `menuAccent`, `rtl`; deps include the `shadcn` runtime package and globals.css gets `@import "shadcn/tailwind.css"`. CORRECTION: `sonner` exists in BOTH base-nova and radix-nova registries (deps sonner + next-themes), so KICKOFF's `sonner` does NOT force `-b radix`; the Base UI docs nav just lists the newer `toast` instead. `add -y` (default false) for non-interactive add. Dark mode: next-themes 0.4.6, attribute="class", suppressHydrationWarning.

@xyflow/react 12.11.6: CSS at '@xyflow/react/dist/style.css'; with Tailwind 4 the docs put `@import '@xyflow/react/dist/style.css' layer(base);` BEFORE `@import 'tailwindcss';`. Controlled nodes/edges via useNodesState/useEdgesState/addEdge; nodeTypes defined outside the component; `NodeProps<Node<Data,'type'>>`; Handle props type/position/id/isConnectable/isValidConnection + HTML attrs; unique handle ids referenced by edge.sourceHandle; `screenToFlowPosition(clientPosition, options?)`; useReactFlow only under ReactFlowProvider; canvas must be 'use client'.

vitest 4.1.11 (Node ^20||^22||>=24; bundles vite as a dependency), `test.projects` with `extends: true`, edge-runtime env needs @edge-runtime/vm 5.0.0, convex-test 0.0.56 (peer convex ^1.43). Use vitest.config.mts with vite-tsconfig-paths 6.1.1. gh 2.91.0 / git 2.50.1 support the bootstrap flags. typescript npm latest is 7.0.2; keep the template's ^5.

## VERSIONS
{
"next": "16.3.4",
"create-next-app": "16.3.4",
"react": "19.2.8",
"react-dom": "19.2.8",
"@types/react": "19.2.18",
"eslint-config-next": "16.3.4",
"typescript": "^5 (template pin; npm latest 7.0.2 \u2014 do not adopt 7 without verifying next/eslint/vite support)",
"tailwindcss": "4.3.3",
"@tailwindcss/postcss": "4.3.3",
"tw-animate-css": "1.4.0",
"shadcn": "4.20.0 (pnpm dlx shadcn@4.20.0; also installed as a runtime dep by init for shadcn/tailwind.css)",
"radix-ui": "1.6.7 (only if init -b radix)",
"@base-ui/react": "1.7.0 (default base)",
"lucide-react": "1.39.0",
"class-variance-authority": "0.7.1",
"next-themes": "0.4.6",
"sonner": "2.0.8",
"@xyflow/react": "12.11.6",
"zod": "4.5.4",
"vitest": "4.1.11",
"vite-tsconfig-paths": "6.1.1",
"@edge-runtime/vm": "5.0.0",
"convex-test": "0.0.56",
"convex": "1.45.0",
"@clerk/nextjs": "7.8.4 (peer next ^16.0.10||^16.1.0-0, react ~19.2.3 \u2014 satisfied by 16.3.4/19.2.8)",
"pnpm": "11.24.0 (installed)",
"gh": "2.91.0 (installed)",
"git": "2.50.1 (installed)"
}

## COMMANDS
- cd /Users/sonnysangha/Documents/Builds/n8n-clone-demo   # must be empty except .git/.gitignore/.claude/.vscode/docs/LICENSE — NO CLAUDE.md yet
- pnpm create next-app@16.3.4 . --yes --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --disable-git --no-agents-md   # '.' => appName n8n-clone-demo; do NOT pass --turbopack (not an option, silently ignored; Turbopack is already default)
- cp /Users/sonnysangha/Downloads/papaflow/CLAUDE.md . && mkdir -p docs && cp /Users/sonnysangha/Downloads/papaflow/docs/*.md docs/   # after scaffold (CLAUDE.md would have blocked create-next-app)
- pnpm dlx shadcn@4.20.0 init -d   # Base UI (default since July 2026), style 'base-nova', non-interactive; sonner IS available here
- pnpm dlx shadcn@4.20.0 init -d -b radix   # ALTERNATIVE: Radix, style 'radix-nova' — pick one; use this only if a dependency needs Radix (e.g. AI Elements)
- pnpm dlx shadcn@4.20.0 add -y button input dialog sheet dropdown-menu badge tabs tooltip sonner card select textarea label separator scroll-area command popover switch table skeleton   # add -y default is false, so -y is required for CI; installs sonner + next-themes
- pnpm add next-themes@0.4.6 @xyflow/react@12.11.6 zod@4.5.4
- pnpm add -D vitest@4.1.11 vite-tsconfig-paths@6.1.1 @edge-runtime/vm@5.0.0 convex-test@0.0.56
- git init -b main && git add -A && git commit -m "chore: scaffold Next.js 16 + shadcn + React Flow"
- gh repo create n8n-clone-demo --private --source=. --push --remote=origin
- pnpm dev   # next dev (Turbopack default); webpack only via `next dev --webpack`
- pnpm vitest run --project unit   # or --project convex
- npx @next/codemod@canary middleware-to-proxy .   # only if a middleware.ts ever gets created by a generator

## NON-CONFIRMED FACTS (15 of 45)
- [wrong] create-next-app accepts --turbopack / --webpack
  TRUTH: v16.3.4 index.ts defines only --rspack for bundlers: `const bundler: Bundler = opts.rspack ? Bundler.Rspack : Bundler.Turbopack`. templates/index.ts: `const bundlerFlags = bundler === Bundler.Webpack ? " --webpack" : ""` so generated scripts are plain `next dev`/`next build`. `.allowUnknownOption()` is called, so --turbopack is silently ignored. The docs table still lists --turbopack/--webpack (doc drift).
  SRC: https://raw.githubusercontent.com/vercel/next.js/v16.3.4/packages/create-next-app/index.ts ; .../templates/index.ts ; https://nextjs.org/docs/app/api-reference/cli/create-next-app
- [partially] docs/ and CLAUDE.md may pre-exist in the target directory
  TRUTH: isFolderEmpty allowlist: .claude .cursor .DS_Store .git .gitattributes .gitignore .gitlab-ci.yml .hg .hgcheck .hgignore .idea .npmignore .travis.yml .vscode .zed LICENSE Thumbs.db docs mkdocs.yml npm-debug.log yarn-debug.log yarn-error.log yarnrc.yml .yarn. `docs` OK; CLAUDE.md and AGENTS.md are NOT and print 'The directory n8n-clone-demo contains files that could conflict:' then exit 1. Copy CLAUDE.md in AFTER scaffolding.
  SRC: https://raw.githubusercontent.com/vercel/next.js/v16.3.4/packages/create-next-app/helpers/is-folder-empty.ts
- [partially] --yes makes create-next-app fully non-interactive
  TRUTH: `let skipPrompt = ciInfo.isCI || opts.yes`; --yes = 'Use saved preferences or defaults for unprovided options' (defaults: typescript true, linter 'eslint', tailwind true, app true, srcDir false, importAlias '@/*', reactCompiler false, agentsMd true, disableGit false). Pass every option explicitly so saved preferences cannot override. `--no-linter`/`--no-eslint` are detected via argv scan.
  SRC: v16.3.4 index.ts (defaults object, skipPrompt)
- [wrong] next build runs the linter
  TRUTH: 'Starting with Next.js 16, `next build` no longer runs the linter automatically.' Run `eslint` via package.json script (template lint script is 'eslint').
  SRC: https://nextjs.org/docs/app/getting-started/installation
- [wrong] Vendor turbopack SKILL.md: opt out with `bundler: 'webpack'` in next.config or BUNDLER=webpack
  TRUTH: No `bundler` option exists in the next.config.js option index for 16.3.4 (options include turbopack, turbopackChunking, turbopackFileSystemCache, webpack, cacheComponents, serverExternalPackages...). Documented opt-out is the `--webpack` CLI flag only.
  SRC: https://nextjs.org/docs/app/api-reference/config/next-config-js ; https://nextjs.org/docs/app/getting-started/installation
- [wrong] Cache Components / PPR enabled via experimental.ppr
  TRUTH: v16: top-level `cacheComponents: true`; 'implements Partial Prerendering (PPR) as the default behavior... the `experimental.ppr` configuration flag and the `experimental_ppr` route segment configuration are no longer necessary and have been removed.' 'Cache Components requires the Node.js runtime.' Opt-in (no create-next-app flag). With it on, components reading cookies()/headers()/auth must be under <Suspense>. Recommendation: leave off for this mostly-dynamic auth-gated app.
  SRC: https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents ; https://nextjs.org/docs/app/api-reference/functions/after
- [partially] shadcn init non-interactive flags are `init -y -d` with --base-color/--style
  TRUTH: shadcn 4.20.0 init options: -t/--template <next|start|vite|react-router|laravel|astro>, -b/--base <base|radix|aria>, -p/--preset [name], -y/--yes (default true), -d/--defaults ('use default configuration: --template=next --preset=base-nova'; code: options.template ||= 'next', options.base ||= 'base', preset = DEFAULT_PRESETS.nova), -f, -c, -n, -s, --css-variables/--no-css-variables, --rtl, --pointer, --reinstall, --monorepo/--no-monorepo. --style, --base-color, --src-dir do NOT exist. Prompts for base/preset run only `if (options.preset === undefined && components.length === 0 && !options.defaults)`, so `-d` is fully non-interactive.
  SRC: https://raw.githubusercontent.com/shadcn-ui/ui/main/packages/shadcn/src/commands/init.ts ; https://ui.shadcn.com/docs/cli
- [wrong] shadcn init defaults to Radix
  TRUTH: 'Starting today, Base UI is the default component library in shadcn/ui.' 'Radix is not being deprecated... every update and new component will ship for both libraries.' 'Prefer Radix for new projects? It's one flag away: npx shadcn init -b radix'. Vendor shadcn SKILL.md ('--base radix (the default)') is stale.
  SRC: https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx ; init.ts
- [wrong] components.json style is only 'new-york' ('default' deprecated)
  TRUTH: schema.json enum for style: default, new-york, radix-{vega,nova,maia,lyra,mira,luma,sera,rhea}, base-{...}, aria-{...}. `init -d` writes style 'base-nova'; `init -d -b radix` writes 'radix-nova' (live /init endpoint returns registry:base 'radix-nova' with config {style:'radix-nova', tailwind.baseColor:'neutral', iconLibrary:'lucide', rtl:false, menuColor:'default', menuAccent:'subtle'} and deps shadcn@latest, class-variance-authority, tw-animate-css, radix-ui, lucide-react). Other top-level keys: rsc, tsx, tailwind{config,css,baseColor,cssVariables,prefix}, aliases, iconLibrary, menuColor, menuAccent, rtl, registries. The components-json docs page text ('new-york') is stale.
  SRC: https://ui.shadcn.com/schema.json ; https://ui.shadcn.com/init?base=radix&style=nova&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=geist&rtl=false&menuAccent=subtle&menuColor=default&radius=default&template=next ; https://ui.shadcn.com/docs/installation/manual
- [wrong] Sonner exists only in the Radix catalogue; KICKOFF's sonner requires `-b radix`
  TRUTH: Both https://ui.shadcn.com/r/styles/base-nova/sonner.json and .../radix-nova/sonner.json exist (name 'sonner', dependencies ['sonner','next-themes'], file starts `"use client"; import { useTheme } from "next-themes"; import { Toaster as Sonner, type ToasterProps } from "sonner"`); a bogus name under base-nova returns 404, so this is not a catch-all. `add sonner` works with either base; `add sonner` also installs next-themes. Base UI docs nav lists the newer `toast` (base-nova/toast.json, deps @base-ui/react, registryDependencies button) instead of sonner; radix-nova/toast.json is 404. Usage: `import { Toaster } from '@/components/ui/sonner'`, `import { toast } from 'sonner'`.
  SRC: https://ui.shadcn.com/r/styles/base-nova/sonner.json ; https://ui.shadcn.com/r/styles/radix-nova/sonner.json ; https://ui.shadcn.com/r/styles/base-nova/toast.json ; https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/content/docs/components/radix/sonner.mdx
- [partially] All requested components exist for the chosen base
  TRUTH: Verified registry items: base-nova: sonner, toast, command (deps cmdk; registryDependencies dialog, input-group), scroll-area (@base-ui/react/scroll-area); radix-nova: sonner, command, dropdown-menu (radix-ui). Not individually fetched: button input dialog sheet badge tabs tooltip card select textarea label separator popover switch table skeleton — all are standard catalogue items; `add` will error on any missing name, so run the add command once and read its output.
  SRC: https://ui.shadcn.com/r/styles/{base-nova,radix-nova}/<name>.json
- [partially] @xyflow/react CSS import path and Tailwind 4 order
  TRUTH: Exports: './dist/style.css' and './dist/base.css'. 'You must import the css stylesheet for React Flow to work.' Tailwind section shows, in this order: `@import '@xyflow/react/dist/style.css' layer(base);` THEN `@import 'tailwindcss';` — 'Import the React Flow stylesheet into the base layer so that Tailwind can override the default styles.' The first researcher put it after tailwindcss; follow the documented order.
  SRC: npm view @xyflow/react exports ; https://reactflow.dev/learn/getting-started/installation-and-requirements ; https://reactflow.dev/learn/customization/theming
- [partially] @xyflow/react must be a client component in Next.js
  TRUTH: React Flow docs never mention 'use client'; SSR page only says nodes need width/height (or initialWidth/initialHeight) and a `handles` array to render server-side. The canvas uses hooks (useNodesState/useReactFlow), which Next.js App Router only allows in 'use client' files — so mark the canvas + node components 'use client' and keep page.tsx a server component.
  SRC: https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration ; vendor nextjs skill rsc-boundaries
- [partially] Second vitest project for convex-test under edge-runtime with server.deps.inline
  TRUTH: Convex docs (Vitest 4): `test.projects: [{ extends: true, test: { name: 'convex', include: ['convex/**/*.test.{ts,js}'], environment: 'edge-runtime' } }, { extends: true, test: { name: 'frontend', include: [...], exclude: ['convex/**'], environment: 'jsdom' } }]`; install `npm install --save-dev convex-test vitest @edge-runtime/vm`; test: `const modules = import.meta.glob('./**/*.ts'); const t = convexTest(schema, modules)`. `server.deps.inline: ['convex-test']` is NOT in the current Convex docs or the convex-test README (vitest defines it as `(string|RegExp)[] | true`); omit it unless convex-test fails to load, then add it. Run one project: `vitest --project convex`.
  SRC: https://docs.convex.dev/testing/convex-test ; https://vitest.dev/guide/projects ; https://vitest.dev/config/server ; npm view convex-test readme
- [wrong] Vendor shadcn SKILL.md components.json example and defaults
  TRUTH: Skill shows baseColor options gray/slate and tailwind.config 'tailwind.config.ts', and says Radix is the default; current CLI writes style 'base-nova'/'radix-nova', baseColor neutral|stone|zinc|mauve|olive|mist|taupe, tailwind.config '' and Base UI default. Its removed-flags list (--style, --base-color, --src-dir) and `-d` advice are correct.
  SRC: /Users/sonnysangha/.claude/plugins/cache/vercel-vercel-plugin/vercel-plugin/0.30.0/skills/shadcn/SKILL.md ; schema.json ; 2026-07-base-ui-default.mdx

## CONFIRMED FACTS
- Current Next.js major is 16; latest stable 16.3.4; create-next-app tracks it → npm dist-tags.latest: next 16.3.4, create-next-app 16.3.4, eslint-config-next 16.3.4; engines.node >=20.9.0. Docs pages report version 16.3.4.
- create-next-app can scaffold into "." and n8n-clone-demo is a valid name → `const appPath = resolve(projectPath); const appName = basename(appPath)`; validate-npm-package-name('n8n-clone-demo') => {validForNewPackages:true}. Then `if (existsSync(appPath) && !isFolderEmpty(appPath, appName)) process.exit(1)`. /Users/sonnysangha/Docume
- --agents-md writes AGENTS.md + CLAUDE.md → helpers/generate-agent-files.ts writes AGENTS.md (Next.js agent rules) and CLAUDE.md containing only `@AGENTS.md`, via fs.writeFileSync with no existence check (unconditional overwrite). Use `--no-agents-md` or overwrite the stub with the papaflow CLAUDE.md af
- `pnpm create next-app@<version>` is a valid invocation → Official installation page shows `pnpm create next-app@latest my-app --yes`; pnpm 11.24.0 `pnpm create <name>` maps to the create-<name> package. Pin: `pnpm create next-app@16.3.4 . ...`.
- Template installs React 19 and Tailwind v4 → templates/index.ts: react/react-dom = '19.2.8' (exact), next = resolved latest, typescript '^5', @types/node '^20', @types/react '^19', @types/react-dom '^19', tailwindcss '^4', @tailwindcss/postcss '^4', eslint '^9', eslint-config-next = resolved latest. Scri
- Turbopack is default for next dev and next build → 'Turbopack is now the default bundler. To use Webpack run `next dev --webpack` or `next build --webpack`.'
- Next.js renamed middleware.ts to proxy.ts → 'The `middleware` file convention is deprecated and has been renamed to `proxy`.' Version history v16.0.0: 'Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime'. File at project root (or src/). Codemod: `npx @next/codemod@canar
- Export name is `proxy` (or default) and the config export is `config` with matcher → 'The file must export a single function, either as a default export or named `proxy`.' Config: `export const config = { matcher: '/about/:path*' }` (string, string[], or objects {source, locale, has, missing}); path-to-regexp; values must be constants. `import
- Proxy runs only in the Node.js runtime → 'Proxy defaults to using the Node.js runtime. The `runtime` config option is not available in Proxy files. Setting the `runtime` config option in Proxy will throw an error.'
- Clerk clerkMiddleware is the default export of proxy.ts with a matcher; @clerk/nextjs 7.8.4 supports Next 16.3.4 → `import { clerkMiddleware } from '@clerk/nextjs/server'; export default clerkMiddleware(); export const config = { matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/(api|trpc)(.*)
- next.config.ts typed with NextConfig → `import type { NextConfig } from 'next'; const nextConfig: NextConfig = {}; export default nextConfig`. '.cjs or .cts extensions are currently not supported.'
- serverExternalPackages is top-level → `serverExternalPackages: ['pkg']`; v15.0.0 'Moved from experimental to stable. Renamed from serverComponentsExternalPackages to serverExternalPackages'.
- after() is stable from next/server → `import { after } from 'next/server'`; usable in Server Components, Server Functions, Route Handlers, Proxy; 'v15.1.0 after became stable'. cookies()/headers() may be called inside the callback in Route Handlers/Server Functions but NOT in Server Components (r
- Route handlers read raw body via await request.text(); params is a Promise; RouteContext helper → Webhook example: `const text = await request.text()`; 'you do not need to use bodyParser'. `{ params }: { params: Promise<{ team: string }> }` then `await params`. `RouteContext<'/users/[id]'>` is globally available after `next dev`/`next build`/`next typegen`
- DEFAULT_PRESETS.nova content → nova = { style: 'nova', baseColor: 'neutral', theme: 'neutral', chartColor: 'neutral', iconLibrary: 'lucide', font: 'geist', fontHeading: 'inherit', menuAccent: 'subtle', menuColor: 'default', radius: 'default', rtl: false }. resolveInitUrl builds `${SHADCN_UR
- shadcn init writes globals.css imports → CLI 4 globals.css begins `@import "tailwindcss"; @import "tw-animate-css"; @import "shadcn/tailwind.css";` — the `shadcn` package is installed as a runtime dependency for that stylesheet. tailwind.config is '' for v4. Vendor skill gotcha: check @theme inline f
- shadcn add command and flags → `shadcn add [options] [components...]`: -y/--yes (default FALSE), -o/--overwrite, -c/--cwd, -a/--all, -p/--path, -s/--silent, --dry-run, --diff [path], --view [path]. Pass -y for non-interactive. Components resolve by the project's style (base-nova / radix-nov
- shadcn supports Tailwind v4 → components.json 'For Tailwind CSS v4, leave this blank' for tailwind.config; manual install uses `@import "tailwindcss"`; tailwindcss latest 4.3.3, @tailwindcss/postcss 4.3.3.
- Dark mode via next-themes attribute=class → `pnpm add next-themes` (0.4.6); components/theme-provider.tsx: `"use client"; import { ThemeProvider as NextThemesProvider } from "next-themes"; export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>)`; `<html lan
- Controlled nodes/edges with useNodesState/useEdgesState/addEdge → `const [nodes, setNodes, onNodesChange] = useNodesState<NodeType>(initialNodes)` returns [NodeType[], Dispatch<SetStateAction<NodeType[]>>, OnNodesChange<NodeType>]; same for useEdgesState. `const onConnect: OnConnect = useCallback((connection) => setEdges((ed
- Connection and IsValidConnection typing → `Connection = { source: string; target: string; sourceHandle: string | null; targetHandle: string | null }`; `type IsValidConnection = (edge: Edge | Connection) => boolean` (ReactFlow prop typed IsValidConnection<Edge>; also a Handle prop).
- nodeTypes must be stable (outside component / useMemo) → 'We define the nodeTypes outside of the component to prevent re-renderings.' Pass as `<ReactFlow nodeTypes={nodeTypes} .../>`. Default nodeTypes: { input, default, output, group }.
- Custom node typing NodeProps<Node<Data,'type'>> → `type NumberNode = Node<{ number: number }, 'number'>; function NumberNode({ data }: NodeProps<NumberNode>)`; `type AppNode = NumberNode | TextNode`; `useReactFlow<CustomNodeType, CustomEdgeType>()`. NodeProps fields: id, data, type, selected, dragging, isConn
- Handle props and multiple source handles with ids → Handle props: id: string|null; type: 'source'|'target' (default 'source'); position: Position (default Position.Top); isConnectable (true); isConnectableStart (true); isConnectableEnd (true); isValidConnection; onConnect; plus HTML div attrs (className, style)
- useReactFlow().screenToFlowPosition and DnD pattern; ReactFlowProvider required → 'This hook can only be used in a component that is a child of a <ReactFlowProvider /> or a <ReactFlow /> component.' `screenToFlowPosition(clientPosition: XYPosition, options?: { snapToGrid?: boolean; snapGrid?: SnapGrid }) => XYPosition`. Official example: on
- deleteKeyCode, selected styling, edge labels, colorMode, MiniMap/Controls/Background → deleteKeyCode: KeyCode | null, default 'Backspace'; colorMode: 'light'|'dark'|'system' (default 'light', adds .dark/.light class on root); fitView boolean; NodeProps.selected boolean and `.react-flow__node.selected` class. Edge: id, source, target, sourceHandl
- vitest + Next + TS with vite-tsconfig-paths, environment node → vitest 4.1.11: 'Vitest requires Vite >=v6.0.0 and Node >=v20.0.0' (engines ^20||^22||>=24); vite is a dependency of vitest (no separate install). `import { defineConfig } from 'vitest/config'`; 'Vitest supports all conventional JS and TS extensions' so vitest.
- gh repo create <name> --private --source=. --push --remote=origin → gh 2.91.0: --private/--public/--internal, -s/--source string, --push ('Push local commits to the new repository'), -r/--remote string, -d/--description, --disable-issues, --disable-wiki, -c/--clone. Requires an existing local repo with at least one commit.
- git init -b main → git 2.50.1: `-b, --[no-]initial-branch <name>`. create-next-app also runs git init unless --disable-git; use --disable-git then `git init -b main` yourself for a deterministic branch name.
- pnpm scripts in CLAUDE.md are compatible with the scaffold → Template scripts: dev/build/start/lint('eslint'). Add: typecheck 'tsc --noEmit', test 'vitest run', convex:dev 'npx convex dev', workflow:web 'npx workflow web'.

## SNIPPETS
### proxy.ts (Next 16) with Clerk — export name `config`, not `proxyConfig`
```
// proxy.ts (project root; NOT middleware.ts)
import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware()

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}
// Node.js runtime only; exporting `runtime` throws. createRouteMatcher() is deprecated — gate with auth() in routes.
```
### next.config.ts
```
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // cacheComponents: true,     // v16 top-level opt-in PPR/use cache — leave OFF for this auth-gated app
  serverExternalPackages: [],   // top-level, stable since 15.0
  // turbopack: { resolveAlias: {} }  // top-level turbopack config; there is NO `bundler` key
}

export default nextConfig
```
### app/globals.css (documented order: React Flow base layer BEFORE tailwindcss)
```
@import '@xyflow/react/dist/style.css' layer(base);
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
/* shadcn 4.20 init writes the three lines above (minus xyflow) plus @theme inline / :root / .dark tokens */
```
### Route handler: raw body + after()
```
import { after } from 'next/server'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest, ctx: RouteContext<'/api/events/[provider]'>) {
  const { provider } = await ctx.params   // params is a Promise; RouteContext is global after typegen
  const raw = await request.text()        // verify HMAC on raw, then JSON.parse
  after(async () => { /* runs after the response is sent; cookies()/headers() allowed here */ })
  return new Response('ok', { status: 200 })
}
```
### components/theme-provider.tsx + layout usage (Toaster from sonner)
```
"use client"
import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}

// app/layout.tsx
// import { Toaster } from "@/components/ui/sonner"   // toast(): import { toast } from "sonner"
// <html lang="en" suppressHydrationWarning>
//   <body>
//     <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
//       {children}
//       <Toaster />
//     </ThemeProvider>
```
### Custom node with typed data and true/false source handles
```
"use client"
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

export type ConditionNode = Node<{ label: string; status: 'idle' | 'running' | 'success' | 'failed' }, 'condition'>

export function ConditionNodeView({ data, selected, isConnectable }: NodeProps<ConditionNode>) {
  return (
    <div className={selected ? 'rounded-md border p-3 ring-2 ring-primary' : 'rounded-md border p-3'}>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      {data.label}
      <Handle type="source" id="true" position={Position.Right} style={{ top: '35%' }} />
      <Handle type="source" id="false" position={Position.Right} style={{ top: '65%' }} />
    </div>
  )
}
// edges out of this node carry sourceHandle: 'true' | 'false'
```
### Canvas: controlled state, stable nodeTypes, HTML5 DnD drop
```
"use client"
import { useCallback } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, useReactFlow, type Edge, type OnConnect } from '@xyflow/react'

const nodeTypes = { condition: ConditionNodeView } // module scope (or useMemo) — never inline
type AppNode = ConditionNode

function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { screenToFlowPosition } = useReactFlow<AppNode, Edge>()
  const onConnect: OnConnect = useCallback((c) => setEdges((eds) => addEdge(c, eds)), [setEdges])
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('text/plain'); if (!type) return
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setNodes((nds) => nds.concat({ id: crypto.randomUUID(), type: 'condition', position, data: { label: type, status: 'idle' } }))
  }, [screenToFlowPosition, setNodes])
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onConnect={onConnect} onDrop={onDrop} onDragOver={onDragOver} fitView deleteKeyCode={['Backspace', 'Delete']}
      isValidConnection={(c) => c.source !== c.target} colorMode="system">
      <Background /><Controls /><MiniMap />
    </ReactFlow>)
}
export default function CanvasPage() { return <ReactFlowProvider><Sidebar /><Canvas /></ReactFlowProvider> }
// Sidebar item: draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', 'condition'); e.dataTransfer.effectAllowed = 'move' }}
```
### vitest.config.mts (unit + convex projects)
```
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', environment: 'node', include: ['{lib,nodes,workflows}/**/*.test.ts'] } },
      { extends: true, test: { name: 'convex', environment: 'edge-runtime', include: ['convex/**/*.test.{ts,js}'] } },
      // add `server: { deps: { inline: ['convex-test'] } }` to the convex project only if convex-test fails to load
    ],
  },
})
// convex/x.test.ts: import { convexTest } from 'convex-test'; import schema from './schema'
// const modules = import.meta.glob('./**/*.ts'); const t = convexTest(schema, modules)
```
### components.json as written by shadcn 4.20 `init -d` (Base UI) / `init -d -b radix`
```
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",              // or "radix-nova" with -b radix; NOT "new-york"
  "rsc": true, "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide", "rtl": false, "menuColor": "default", "menuAccent": "subtle"
}
// baseColor options: neutral | stone | zinc | mauve | olive | mist | taupe
```
