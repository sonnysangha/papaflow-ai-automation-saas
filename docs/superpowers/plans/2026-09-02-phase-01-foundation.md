# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one fresh Opus subagent per task, sequential, tests first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Clerk (orgs) + Convex (native integration, webhook sync) + React Flow canvas that saves graph JSON per organisation + `defineNode` registry with three real nodes + workflow list + org switcher.

**Architecture:** Next.js 16 App Router with `proxy.ts` (Clerk middleware, matcher excludes Workflow SDK + eve paths). Convex holds all state; the browser subscribes with `useQuery`. Clerk is the identity + organisation source; a Convex `httpAction` receives Clerk webhooks (`verifyWebhook`) and mirrors organisations, memberships and plans. Node definitions are zod-first files registered in `nodes/registry.ts`.

**Tech Stack (installed, exact):** next 16.3.4, react 19.2.8, @clerk/nextjs 7.8.4, @clerk/backend 3.17.0, convex 1.45.0, @xyflow/react 12.11.6, zod 4.5.4, shadcn 4.20 (Base UI, style `base-nova`), sonner, next-themes, lucide-react, vitest 4.1.11 + convex-test 0.0.56.

**Spec:** `CLAUDE.md`, the master plan (`Architecture`, `Verified stack`, `Phase 1`), `docs/research/{clerk,convex,nextjs-ui}.md`.

## Global constraints

- Exact names from the verified research win over any skill or memory. Read `docs/research/clerk.md`, `docs/research/convex.md`, `docs/research/nextjs-ui.md` (SUMMARY + SNIPPETS) before coding; when unsure, read the installed `.d.ts` under `node_modules`.
- Next 16: the middleware file is `proxy.ts` at the repo root and exports `config` (never `proxyConfig`, never `middleware.ts`). `auth()` is async. `createRouteMatcher` is deprecated: gate with `auth()` in layouts/routes.
- Every Convex table row carries `orgId` (Clerk org id). Every query/mutation for app data calls `requireOrg(ctx)` first and filters by `orgId`.
- Secrets never reach the client. Nothing in this phase touches `connections`.
- Plan slugs: `free_org` | `pro` | `team` (`lib/plans.ts`). Until an org has an `orgPlans` row it is `free_org`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test` (vitest projects `unit` and `convex`), `CONVEX_ALLOW_ANONYMOUS=false npx convex dev --once` to push Convex code, `pnpm dev` for the app.
- Commit per task with conventional messages (`feat(auth): …`), trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never commit `.env*.local`.

## File structure

```
proxy.ts                                   Clerk middleware + matcher
app/layout.tsx                             html/body, ThemeProvider, ClerkProvider (inside body), ConvexClientProvider, Toaster, TooltipProvider
app/ConvexClientProvider.tsx               "use client" ConvexProviderWithClerk
app/globals.css                            add React Flow base layer import
app/page.tsx                               landing: CTA → /sign-in, redirect to /w when signed in
app/sign-in/[[...sign-in]]/page.tsx        <SignIn />
app/sign-up/[[...sign-up]]/page.tsx        <SignUp />
app/select-org/page.tsx                    <OrganizationList hidePersonal … />
app/(app)/layout.tsx                       auth guard (signed in + active org) + header (OrganizationSwitcher, UserButton, nav)
app/(app)/w/page.tsx                       workflow list (client component inside)
app/(app)/w/[workflowId]/page.tsx          editor page → <Editor workflowId />
components/app/Header.tsx                  header UI
components/workflows/WorkflowList.tsx      list + create/rename/delete
components/canvas/{Editor,Canvas,NodeSidebar,WorkflowNode,StatusRing}.tsx
components/theme-provider.tsx
convex/lib/auth.ts                         requireOrg(ctx)
convex/lib/plan.ts                         currentPlan(ctx, orgId) → { slug, features, limits }
convex/plan.ts                             plan.current query (from token claims)
convex/workflows.ts                        list/get/create/saveGraph/rename/remove
convex/test.setup.ts                       import.meta.glob modules for convex-test
convex/plan.test.ts                        plan-from-claims tests
nodes/define.ts  nodes/registry.ts  nodes/categories.ts  nodes/schema.ts (zod → JSON schema helper)
nodes/triggers/manual.ts  nodes/actions/http-request.ts  nodes/actions/email-send.ts
tests/registry.test.ts  tests/plans.test.ts  tests/nodes.test.ts
README.md                                  setup + commands (short)
```

---

### Task 1: Clerk shell — proxy, providers, sign-in/up, app layout guard, header

**Files:** create `proxy.ts`, `app/ConvexClientProvider.tsx`, `components/theme-provider.tsx`, `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`, `app/select-org/page.tsx`, `app/(app)/layout.tsx`, `components/app/Header.tsx`; modify `app/layout.tsx`, `app/page.tsx`, `app/globals.css`.

**Interfaces:** Produces the `(app)` route group whose layout guarantees `userId` and `orgId` for every page under it.

- [ ] **Step 1: `proxy.ts`** (verbatim; the matcher deliberately excludes `.well-known/workflow/` and `eve/` for later phases):

```ts
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(); // protects nothing; pages/routes call auth() themselves

export const config = {
  matcher: [
    "/((?!_next|\\.well-known/workflow/|eve/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
```

- [ ] **Step 2: providers.** `app/ConvexClientProvider.tsx`:

```tsx
"use client";
import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProviderWithClerk client={convex} useAuth={useAuth}>{children}</ConvexProviderWithClerk>;
}
```

`components/theme-provider.tsx` wraps `next-themes` `ThemeProvider`. `app/layout.tsx`: `<html lang="en" suppressHydrationWarning className={fontVars}>` → `<body>` → `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>` → `<ClerkProvider>` → `<ConvexClientProvider>` → `<TooltipProvider>` (export name: check `components/ui/tooltip.tsx`) → `{children}` + `<Toaster />` (from `@/components/ui/sonner`). Keep the Geist fonts from the scaffold; if `@theme inline` in `globals.css` references `var(--font-sans)` circularly, replace with literal font names (see the shadcn gotcha in the research digest).

- [ ] **Step 3: `app/globals.css`** — add as the FIRST line: `@import "@xyflow/react/dist/style.css" layer(base);` (documented order: before `@import "tailwindcss"`).

- [ ] **Step 4: pages.** `app/sign-in/[[...sign-in]]/page.tsx` renders `<SignIn />`; sign-up likewise. `app/select-org/page.tsx` renders `<OrganizationList hidePersonal afterSelectOrganizationUrl="/w" afterCreateOrganizationUrl="/w" />` centred. `app/page.tsx`: server component — `const { isAuthenticated } = await auth(); if (isAuthenticated) redirect("/w");` else a simple landing (name, one-line pitch, `<Button asChild><Link href="/sign-in">Sign in</Link></Button>`).

- [ ] **Step 5: `app/(app)/layout.tsx`** (server component):

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Header } from "@/components/app/Header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, orgId } = await auth();
  if (!isAuthenticated) redirect("/sign-in");
  if (!orgId) redirect("/select-org");
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
```

`components/app/Header.tsx`: sticky top bar with the wordmark "PapaFlow" (link to `/w`), nav links `Workflows` (`/w`), `Runs` (`/runs`, may 404 for now), `Connections` (`/connections`, 404 for now), `Settings` (`/settings`, 404), then `<OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/w" afterCreateOrganizationUrl="/w" />` and `<UserButton />` from `@clerk/nextjs`. Use shadcn tokens (`border-border`, `bg-background`), no ad-hoc colours.

- [ ] **Step 6: verify.** `pnpm typecheck && pnpm lint` pass. `pnpm dev` then open `http://localhost:3000` → landing; `/w` → redirects to `/sign-in`; `/sign-in` renders the Clerk form (no console errors about publishable key). Commit `feat(auth): clerk shell with proxy, providers, org guard`.

---

### Task 2: Convex auth helpers and plan-from-claims (+ tests)

**Scope change (user):** Clerk is the source of truth for organisations, memberships and billing. There is no Clerk webhook and no `organizations`/`memberships`/`orgPlans` tables (remove them from `convex/schema.ts`).

**Files:** create `convex/lib/auth.ts`, `convex/lib/plan.ts`, `convex/plan.ts`, `convex/test.setup.ts`, `convex/plan.test.ts`; modify `convex/schema.ts` (drop the three tables).

**Interfaces:**
- `requireOrg(ctx): Promise<{ userId; orgId; role?; plan: string; features: string[] }>` — org id from `org_id` (only when it starts with `org_`) ?? `o.id`; `plan` from the `pla` claim (`o:<slug>` → slug, missing/unknown → `free_org`); `features` from the `fea` claim (comma-separated, keep `o:`-prefixed entries with the prefix stripped; missing → `featuresForPlan(plan)`).
- `currentPlan(ctx)` → `{ slug, features, limits }` from `requireOrg` (no table reads).
- `api.plan.current()` → `{ slug, features, limits }` with `Infinity` mapped to `null`.

- [ ] Step 1: tests first (`convex/plan.test.ts`): identity with `pla: "o:pro", fea: "o:core_connectors,o:ai_builder,u:ignored"` → slug `pro`, features `["core_connectors","ai_builder"]`, `limits.workflows === null`; missing `pla` → `free_org` with `FEATURES.free_org`; unknown slug → `free_org`; identity without an org claim → throws.
- [ ] Step 2: implement; `pnpm test --project convex`; push with `CONVEX_ALLOW_ANONYMOUS=false npx convex dev --once`; typecheck. Commit `feat(convex): org auth helpers and plan from Clerk claims`.

---

### Task 3: Node definitions — defineNode, registry, three nodes (+ tests)

**Files:** create `nodes/define.ts`, `nodes/categories.ts`, `nodes/schema.ts`, `nodes/registry.ts`, `nodes/triggers/manual.ts`, `nodes/actions/http-request.ts`, `nodes/actions/email-send.ts`, `tests/registry.test.ts`, `tests/nodes.test.ts`, `tests/plans.test.ts`.

**Interfaces (consumed by the canvas and, in Phase 2, by `runNode`):**

```ts
// nodes/define.ts
import { z } from "zod";
export type NodeCategory = "trigger" | "logic" | "ai" | "action";
export type Control = { kind: "sleep"; ms: number } | { kind: "hook" } | undefined;
export interface RunContext<I> { inputs: I; credential?: Record<string, unknown>; orgId: string; executionId: string; nodeId: string; hookToken?: string }
export interface NodeDef<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string; name: string; description: string; category: NodeCategory; icon: string; // lucide icon name
  credential: string | null; requiresFeature: string | null; version: "v1" | "v2";
  inputs: I; outputs: O;
  handles?: (inputs: z.infer<I>) => string[];           // source handle ids; default ["out"]
  handle?: (out: z.infer<O>) => string | null;
  control?: (out: z.infer<O>) => Control;
  run: (ctx: RunContext<z.infer<I>>) => Promise<z.infer<O>>;
}
export function defineNode<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(def: NodeDef<I, O>): NodeDef<I, O> { return def; }
export class ConnectorError extends Error { constructor(message: string, public status: number, public retryAfter?: string) { super(message); this.name = "ConnectorError"; } }
```

`nodes/schema.ts`: `export function toJsonSchema(schema: z.ZodTypeAny) { return z.toJSONSchema(schema); }` (zod 4 built-in; verify the export exists with `grep toJSONSchema node_modules/zod/v4/classic/*.d.ts`). `nodes/categories.ts`: ordered list `[{ id: "trigger", label: "Triggers" }, { id: "logic", label: "Logic" }, { id: "ai", label: "AI" }, { id: "action", label: "Actions" }]`. `nodes/registry.ts`: `NODES: Record<string, NodeDef>` built from an array; throws at module load on duplicate `type`; `nodeCatalogue(features: readonly string[])` → `[{ type, name, description, category, icon, version, requiresFeature, allowed: !requiresFeature || features.includes(requiresFeature), inputsSchema: toJsonSchema(inputs), outputsSchema: toJsonSchema(outputs), handles: def.handles?.(defaultInputs) ?? ["out"] }]`. Registry and node files must not import React or Next (they are shared with Convex/Workflow code later).

Nodes (all `version: "v1"`, `requiresFeature: null`, `credential: null` for now):
- `manual.trigger` (category trigger, icon `Play`): inputs `z.object({ sample: z.string().default("{}").describe("Sample JSON payload used when you press Run") })`, outputs `z.object({ payload: z.any() })`, `run` parses `sample` (invalid JSON → `{}`) and returns `{ payload }`.
- `http.request` (action, icon `Globe`): inputs `{ method: z.enum(["GET","POST","PUT","PATCH","DELETE"]).default("GET"), url: z.string().url(), headers: z.record(z.string(), z.string()).default({}), body: z.string().optional().describe("Raw body; JSON is sent as-is") }`, outputs `{ status: z.number(), headers: z.record(z.string(), z.string()), body: z.any() }`; `run` uses global `fetch`, parses JSON when `content-type` includes `application/json` else text; throws `ConnectorError(text, res.status, res.headers.get("retry-after") ?? undefined)` for status ≥ 400.
- `email.send` (action, icon `Mail`): inputs `{ to: z.string().email(), subject: z.string().min(1), text: z.string().min(1), from: z.string().email().optional() }`, outputs `{ id: z.string() }`; `run` POSTs `https://api.resend.com/emails` with headers `Authorization: Bearer ${key}`, `Content-Type: application/json`, `User-Agent: papaflow/0.1` (Resend rejects requests without one), body `{ from: from ?? "PapaFlow <onboarding@resend.dev>", to: [to], subject, text }`; key = `ctx.credential?.apiKey ?? process.env.RESEND_API_KEY`; missing key → `ConnectorError("No Resend key configured", 400)`; non-2xx → `ConnectorError` with the response text.

- [ ] **Step 1: tests first** — `tests/registry.test.ts`: every `type` unique and matches `/^[a-z]+\.[a-zA-Z]+$/`; `nodeCatalogue(["core_connectors"])` returns three entries with `inputsSchema.type === "object"` and `allowed === true`; `nodeCatalogue([])` still allows nodes with `requiresFeature: null`. `tests/nodes.test.ts`: `manual.trigger` run with `sample: '{"a":1}'` → `{ payload: { a: 1 } }` and invalid JSON → `{ payload: {} }`; `http.request` run against a mocked `fetch` (`vi.stubGlobal("fetch", …)`) returns parsed JSON and throws `ConnectorError` with `status` on 500; `email.send` with no key throws `ConnectorError`, with a mocked 200 returns `{ id }` and the request carried a `User-Agent` header. `tests/plans.test.ts`: `featuresForPlan("pro")` includes `ai_builder`; unknown slug falls back to `free_org`; `limitsForPlan("free_org").workflows === 3`. Run `pnpm test --project unit` → fails.
- [ ] **Step 2: implement** the files above. `pnpm test --project unit` → passes. `pnpm typecheck` passes.
- [ ] **Step 3: commit** `feat(nodes): defineNode registry with manual trigger, http request, resend email`.

---

### Task 4: Convex `workflows` functions (+ tests)

**Files:** create `convex/workflows.ts`, `convex/workflows.test.ts`; uses `requireOrg`, `currentPlan`.

**Interfaces:**
- `api.workflows.list()` → `{ _id, name, status, version, updatedAt, _creationTime }[]` for the active org, newest first (`by_org_updated`, `order("desc")`).
- `api.workflows.get({ id })` → the document (throws if not in org).
- `api.workflows.create({ name })` → `Id<"workflows">`; refuses with `ConvexError({ code: "plan_limit", limit })` when the org's workflow count ≥ `limits.workflows`.
- `api.workflows.saveGraph({ id, graph, expectedVersion })` → `{ version }`; throws `ConvexError({ code: "version_conflict", version })` when `doc.version !== expectedVersion`; increments `version`, sets `lastEditSource: "canvas"`, `lastEditedBy`, `updatedAt`.
- `api.workflows.rename({ id, name })`, `api.workflows.remove({ id })`.

Graph validator (reused in later phases): `export const graphValidator = v.object({ nodes: v.array(v.any()), edges: v.array(v.any()), viewport: v.optional(v.any()), triggerId: v.optional(v.string()) })`. `create` seeds `graph = { nodes: [], edges: [] }`, `version: 1`, `status: "draft"`, `webhookSecret` = 32 random base64url chars from `crypto.getRandomValues` (Convex runtime supports Web Crypto; fall back to `Math.random`-based hex if it throws), `createdBy = userId`.

- [ ] **Step 1: tests** (`convex/workflows.test.ts`, `t.withIdentity({ subject: "user_1", issuer: "https://x.clerk.accounts.dev", org_id: "org_1" })`): create → list shows it with `version 1`; fourth create on `free_org` throws with `plan_limit`; `saveGraph` with stale `expectedVersion` throws `version_conflict`; a second identity with `org_id: "org_2"` cannot `get` org_1's workflow. Run → fails.
- [ ] **Step 2: implement**; run `pnpm test --project convex` → passes; push with `CONVEX_ALLOW_ANONYMOUS=false npx convex dev --once`; typecheck.
- [ ] **Step 3: commit** `feat(workflows): org-scoped crud with optimistic versioning and plan wall`.

---

### Task 5: Canvas — editor, sidebar drag-to-add, custom node with status ring, debounced save

**Files:** create `app/(app)/w/[workflowId]/page.tsx`, `components/canvas/Editor.tsx`, `components/canvas/Canvas.tsx`, `components/canvas/NodeSidebar.tsx`, `components/canvas/WorkflowNode.tsx`, `components/canvas/StatusRing.tsx`, `components/canvas/graph-io.ts`.

**Interfaces:**
- Canvas node shape stored in Convex: `{ id: string, type: "papaflow", position: { x, y }, data: { nodeType: string, label: string, inputs: Record<string, unknown> } }`; edges: `{ id, source, target, sourceHandle?: string, targetHandle?: string }`. `graph-io.ts` exports `toStoredGraph(nodes, edges, viewport)` (strips `selected`, `dragging`, `measured`, `width`, `height`) and `fromStoredGraph(graph)`.
- `WorkflowNode` data also carries a runtime-only `status: "idle" | "running" | "success" | "failed" | "waiting"` (default `idle`; Phase 2 feeds it from `steps`).

- [ ] **Step 1: page + editor.** `page.tsx` is a server component: `const { workflowId } = await params;` → `<Editor workflowId={workflowId as Id<"workflows">} />`. `Editor.tsx` (`"use client"`): `const wf = useQuery(api.workflows.get, { id })`; loading → `<Skeleton>`; then `<ReactFlowProvider><div className="flex h-[calc(100vh-3.5rem)]"><NodeSidebar /><Canvas workflow={wf} /></div></ReactFlowProvider>`; a top strip shows the name (editable inline → `rename`), version, and a "Saved / Saving… / Conflict" indicator driven by Canvas state (lift via a small context or props).
- [ ] **Step 2: `Canvas.tsx`** — controlled `useNodesState`/`useEdgesState` seeded from `fromStoredGraph(workflow.graph)`; `nodeTypes = { papaflow: WorkflowNode }` at module scope; `onConnect` → `addEdge({ ...connection, id: crypto.randomUUID() }, eds)`; `isValidConnection` rejects self-loops and duplicate `source+sourceHandle→target`; `onDragOver` sets `dropEffect = "move"`; `onDrop` reads `dataTransfer.getData("application/papaflow-node")` (the node `type`), positions with `screenToFlowPosition({ x: e.clientX, y: e.clientY })`, appends `{ id: crypto.randomUUID(), type: "papaflow", position, data: { nodeType, label: NODES[nodeType].name, inputs: {}, status: "idle" } }`; `<Background /> <Controls /> <MiniMap pannable zoomable />`; `fitView`; `deleteKeyCode={["Backspace", "Delete"]}`; `colorMode="system"`. Save: a `useEffect` on `[nodes, edges]` (skip the first render) debounces 600 ms → `saveGraph({ id, graph: toStoredGraph(...), expectedVersion: versionRef.current })` → on success `versionRef.current = version`, status "Saved"; on `ConvexError` `version_conflict` → toast "Someone else edited this workflow — reloading" and reset local state from the latest `workflow.graph` + version. When `workflow.version` from the subscription exceeds `versionRef.current` while there are no pending local edits, adopt the server graph (this is what lets the Builder agent draw live in Phase 12).
- [ ] **Step 3: `NodeSidebar.tsx`** — left column (w-64, `border-r`), search input, groups per `nodes/categories.ts` from `nodeCatalogue(features)` where `features` comes from `useQuery(api.orgPlans.current)?.features ?? []`; each item is a `<div draggable onDragStart>` card with the lucide icon (`import * as icons from "lucide-react"`, resolve by name with a fallback) and description; items with `allowed === false` render dimmed with a "Pro" `<Badge>`; `version === "v2"` items render dimmed with "Soon".
- [ ] **Step 4: `WorkflowNode.tsx` + `StatusRing.tsx`** — `NodeProps<Node<WorkflowNodeData, "papaflow">>`; card `min-w-44 rounded-lg border bg-card p-3 shadow-sm`, `ring-2 ring-primary` when `selected`; header row: icon + label + category badge; `StatusRing` = a small circle whose colour maps `idle→muted`, `running→amber + animate-pulse`, `success→green`, `failed→red`, `waiting→blue`; one `<Handle type="target" position={Position.Left} />` unless category is `trigger`; source handles from `NODES[nodeType].handles?.(inputs) ?? ["out"]` rendered on the right, spaced vertically, each with `id`, and a tiny label when there is more than one.
- [ ] **Step 5: verify** — `pnpm typecheck && pnpm lint`; in the browser: open a workflow, drag Manual → HTTP → Email from the sidebar, connect them, reload → the graph persists (Convex data view shows `version` incremented and `graph.nodes.length === 3`); delete a node with Backspace → saved. Commit `feat(canvas): react flow editor with sidebar drag, custom nodes, debounced org-scoped save`.

---

### Task 6: Workflow list page

**Files:** create `app/(app)/w/page.tsx`, `components/workflows/WorkflowList.tsx`.

- [ ] **Step 1:** `page.tsx` renders a heading "Workflows", a "New workflow" `<Button>` and `<WorkflowList />`. `WorkflowList` (`"use client"`): `useQuery(api.workflows.list)`; `undefined` → three `<Skeleton>` rows; empty → an empty-state `<Card>` with the same New button; rows → `<Table>` with name (link to `/w/[id]`), status `<Badge>`, version, "updated x ago"; a row `<DropdownMenu>` with Rename (inline `<Input>` in a `<Dialog>`) and Delete (confirm `<Dialog>` with destructive button). New → `<Dialog>` asking for a name → `create` → `router.push("/w/" + id)`; a `ConvexError` with `code: "plan_limit"` → `toast.error("Free plan allows 3 workflows — upgrade to add more")` (Phase 11 replaces this with the upgrade card).
- [ ] **Step 2: verify + commit** `feat(workflows): list page with create, rename, delete`.

---

### Task 7: README + phase check

- [ ] **Step 1:** `README.md`: what PapaFlow is (3 lines), setup (`pnpm install`, `clerk env pull --file .env.local`, `npx convex dev`, `.env.example` vars), commands, links to `docs/PLAN.md`, `docs/PROVISIONING.md`, `docs/research/`.
- [ ] **Step 2: phase check** (with the user's Clerk Convex integration activated): sign in with a Clerk **test-mode** identity (`<name>+clerk_test@example.com`, verification code `424242` — Clerk development instances accept these without sending email); create org A, create a workflow, draw Manual → HTTP → Email; switch to a new org B via the switcher → the list is empty; back to A → the workflow is there; `workflows.version` > 1 after edits and `api.plan.current` returns `free_org`. `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] **Step 3: commit + push** `docs: readme and phase 1 check`.
