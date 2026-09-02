# Phase 10 eve spike — findings

Run date 2026-09-02/03. Spike root: `/private/tmp/claude-501/.../scratchpad/eve-spike` (throwaway).
Installed and verified against: `eve@0.49.0`, `next@16.3.4`, `react@19.2.8`, `workflow@5.0.0-beta.47`,
`ai@7.0.90`, `zod@4.5.4`, `@ai-sdk/anthropic@4.0.48`, `typescript@5.9.3`, Node v24.14.1.
Source of truth for every quote below is `node_modules/eve/**` in this spike, not the web.

Everything was executed: `eve info`, `next dev` (Turbopack), `next build`, `eve build` + `eve start`
(production, EVE_DEV unset), `eve/client` from a Node script, and live curl against every route.
No paid model was called — every turn dies at `MODEL_CALL_FAILED / "AI Gateway received no credentials"`,
which is *after* auth, model resolution and dynamic-tool resolution, so all of those are still proven.

---

## Verdict

**Nothing blocks Phase 10.** Ten of the plan's assumptions are confirmed verbatim. Six need a
correction or an addition, none of them structural. The two genuinely important ones:

1. `SessionAuthContext.attributes` is **required** and its values must be `string | readonly string[]`
   — not `Record<string, unknown>`.
2. The Agent node does **not** need a minted Clerk token. `jwtHmac()` is a shipped authenticator that
   projects every custom JWT claim into `ctx.session.auth.current.attributes`, so a step signs a
   5-minute HS256 token with `ENGINE_SECRET` carrying `orgId`/`plan`/`executionId`. Proven end to end.

---

## 1. `next.config.mts` — CONFIRMED (with one correction)

`withEve(withWorkflow(nextConfig), { agents })` works. `next dev` serves
`GET /eve/agents/runtime/eve/v1/health` **and** `POST /.well-known/workflow/v1/flow`, and
`start(helloWorkflow, ...)` from a route handler returns a `runId`.

```
$ curl -s http://127.0.0.1:3999/eve/agents/runtime/eve/v1/health
{"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}

$ curl -s -o /dev/null -w '%{http_code}' -XPOST -d '{}' \
    http://127.0.0.1:3999/.well-known/workflow/v1/flow
400            # route mounted ("Missing required headers"), not 404

$ curl -s -XPOST http://127.0.0.1:3999/api/start
{"runId":"wrun_01M1HV9DCTBAGWK7GXXPD88A04"}
```

The minimal working config, unchanged from the plan:

```ts
// next.config.mts
import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  agentRules: false,      // already in the repo — keep it, see §12
  reactCompiler: true,    // already in the repo
};

export default withEve(withWorkflow(nextConfig), {
  agents: { runtime: "./agents/runtime" },   // never combine with eveRoot
});
```

`WithEveOptions` from `node_modules/eve/dist/src/public/next/index.d.ts` is exactly what the plan
assumed:

```ts
export declare function withEve<TConfig extends EveNextConfig>(
  configOrFunction: EveNextConfigInput<TConfig>,
  options?: WithEveOptions,
): EveNextConfigFunction<TConfig>;

export interface WithEveOptions {
  readonly devServerTimeoutMs?: number;   // default 180000
  readonly eveRoot?: string;              // do not combine with `agents`
  readonly agents?: Record<string, string | { root: string; buildCommand?: string; servicePrefix?: string }>;
  readonly eveBuildCommand?: string;
  readonly servicePrefix?: string;        // default "/_eve_internal/eve"
}
```

**Correction — wrapper order does not matter (in dev or build).** The reversed
`withWorkflow(withEve(nextConfig, { agents }))` was tested on a second port and served health 200,
`.well-known/workflow/v1/flow` 400 and `/api/start` 200 identically. Keep the documented
`withEve(withWorkflow(...))` order anyway (it is what the eve docs show and what the Build Output test
below used), but the plan's "spike the order" worry is resolved: neither order breaks.

**Correction — `.mts` is NOT required.** The plan says "`next.config.mts` required (eve/next is
ESM-only)". Tested the exact repo shape (package.json with **no** `"type": "module"`, matching
`/Users/sonnysangha/Documents/Builds/n8n-clone-demo/package.json`) and `next.config.ts` with `withEve`
built cleanly under Next 16.3.4. Keep `.mts` — the repo already uses it and it works — but drop
"required" from the claim; it is a preference, not a constraint.

**Turbopack:** both `next dev` and `next build` ran `▲ Next.js 16.3.4 (Turbopack)` with no opt-out.
`withWorkflow`'s `runAfterProductionCompile` hook ran under Turbopack too.

---

## 2. Agent directory layout — CONFIRMED, and it is **flat**

`eve info` reports `Layout  flat` for `agents/runtime/`. The directory named in `agents` **is** the
agent root; there is no nested `agent/` subdirectory. Layout that compiled with 0 errors:

```
agents/runtime/
├── agent.ts                 # defineAgent({ model })
├── instructions.md          # required on the root agent
├── channels/eve.ts          # route auth
└── tools/
    ├── connectors.ts        # defineDynamic → per-session tools
    ├── request_connection.ts# durable "use workflow" tool
    └── bash.ts              # disableTool() — see §7
```

Notes:
- `eve info` / `eve build` / `eve start` must be run **from the agent root**, not the repo root
  (`Could not resolve an eve agent root from <repo root>` otherwise). `next dev` handles this itself.
- `agents/runtime/` needs **no** `package.json`; the agent name (`runtime`) comes from the directory.
  Confirmed: `Compile ready`, `config.name: "runtime"` in the compiled manifest.
- Everything in the docs written as `agent/<slot>` maps to `agents/<name>/<slot>` in multi-agent mode.

---

## 3. `channels/eve.ts` + production fail-closed — CONFIRMED, with a **type correction**

### Fail-closed, measured

| build | request | result |
|---|---|---|
| authored `channels/eve.ts`, `eve start` (no `EVE_DEV`) | `GET /eve/v1/health` | `200 {"ok":true,"status":"ready",...}` (public) |
| same | `POST /eve/v1/session`, no auth | `401`, `www-authenticate: Bearer`, `{"code":"unauthorized","error":"Authorization is required for this route.","ok":false}` |
| same | `POST /eve/v1/session`, valid bearer | `202` |
| same | `POST /eve/v1/session`, junk bearer | `401` |
| **`channels/eve.ts` deleted**, rebuilt, `eve start` | `POST /eve/v1/session`, no auth | `401` (default channel = `[vercelOidc(), localDev(), placeholderAuth()]`) |

So CLAUDE.md rule 8's "production fails closed without one" is right — and it is *also* true **with**
the default channel; the reason to author the file is not fail-closed, it is to let real users in.

### Authenticator API — confirmed

```ts
// eve/channels/auth
export type AuthFn<TEvent = Request> = (event: TEvent) =>
  SessionAuthContext | null | undefined | Promise<SessionAuthContext | null | undefined>;

export declare function extractBearerToken(authorizationHeader: string | null): string | null;
export declare function localDev(): AuthFn<Request>;
export declare function jwtHmac(config: VerifyJwtHmacConfig): AuthFn<Request>;
export declare function vercelOidc(opts?: VerifyVercelOidcOptions): AuthFn<Request>;
export declare function oidc(config: VerifyOidcConfig): AuthFn<Request>;
export declare function httpBasic(credentials, options?): AuthFn<Request>;
export declare function none<TEvent = unknown>(): AuthFn<TEvent>;
export declare function placeholderAuth(): AuthFn<Request>;
export declare function withAuthChallenges<TEvent>(fn, challenges): AuthFn<TEvent>;
export declare function routeAuth(request, auth): Promise<SessionAuthContext | Response>;
export declare class UnauthenticatedError extends Error {}  // 401
export declare class ForbiddenError extends Error {}        // 403
```

### **WRONG in docs/research/eve.md:** the `SessionAuthContext` shape

```ts
// node_modules/eve/dist/src/channel/types.d.ts:102
export interface SessionAuthContext {
    readonly attributes: Readonly<Record<string, string | readonly string[]>>;   // REQUIRED
    readonly authenticator: string;
    readonly issuer?: string;
    readonly principalId: string;
    readonly principalType: string;
    readonly subject?: string;
}
```

`attributes` is **not optional** and is **not** `Record<string, unknown>` (research doc said
`attributes?: Record<string, unknown>`). Values must be `string` or `readonly string[]`. A boolean or
a number will not type-check — stringify plan limits and feature flags before putting them there.

### Minimal working `channels/eve.ts` (the Phase 10 shape, tested)

```ts
// agents/runtime/channels/eve.ts
import { eveChannel } from "eve/channels/eve";
import { extractBearerToken, jwtHmac, localDev, type AuthFn } from "eve/channels/auth";

// Browser callers (Builder chat panel): Clerk session JWT -> a *user* principal.
function clerkAuth(): AuthFn<Request> {
  return async (request) => {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (!token) return null;                       // skip -> next entry
    const claims = await verifyClerkToken(token);  // @clerk/backend verifyToken
    if (!claims) return null;
    return {
      authenticator: "clerk",
      issuer: claims.iss,
      principalId: claims.sub,
      principalType: "user",
      subject: claims.sub,
      attributes: { orgId: claims.org_id ?? "", plan: String(claims.pla ?? "") }, // strings only
    };
  };
}

export default eveChannel({
  auth: [
    clerkAuth(),
    // Engine callers (Agent node step): HS256 token minted with ENGINE_SECRET.
    jwtHmac({
      algorithm: "HS256",
      issuer: "papaflow-engine",
      audiences: ["papaflow-runtime"],
      secret: process.env.ENGINE_SECRET!,
    }),
    localDev(),   // final fallback; inert outside `eve dev` / `vercel dev`
  ],
});
```

Verified live — the custom `AuthFn` reaches runtime code intact. A probe that echoed
`ctx.session.auth.current` into the model id returned:

```
spikeprobe/auth-clerk-user-user_1-org_abc-pro                       # custom clerk-shaped AuthFn
spikeprobe/auth-local-dev-local-dev-local-dev-undefined-undefined   # localDev() fallback
```

Note the second line: `localDev()` yields `principalType: "local-dev"`, **not** `"user"`, and carries
no attributes. Any code path that keys on `attributes.orgId` must handle that in dev.

---

## 4. The Agent node's bearer token — **plan should change**

Phase 10 Task 1 says: *"bearer = a short-lived Clerk token minted for the org via `@clerk/backend`"*.
That is not necessary and Clerk has no clean server-side "mint a session token for an org" primitive.

`jwtHmac()` verifies an HS256 bearer and **projects every non-standard string claim into
`attributes`** (`aud/exp/iat/iss/jti/nbf/sub` are stripped;
`node_modules/eve/dist/src/channel/auth/token-claims.js`, `createJwtAttributeProjection`). Proven:
a step-minted token with `{ iss: "papaflow-engine", aud: "papaflow-runtime", sub: org, orgId, plan,
executionId }` produced

```
ENGINE PROBE: spikeprobe/jwt-hmac-service-org=org_abc-plan=pro-exec=exec_123
```

**Replacement sentence for Phase 10 Task 1:**

> `lib/eve.ts` (client factory; the bearer is a 5-minute HS256 JWT signed inside the step with
> `ENGINE_SECRET`, carrying `orgId`, `plan` and `executionId` as claims — `jwtHmac()` in the agent's
> channel projects them into `ctx.session.auth.current.attributes`; never send a user's Clerk session
> token from a step).

Two consequences to keep in mind:
- `jwtHmac()` sets `principalType: "service"` and `principalId: "${iss}:${sub}"`. `@vercel/connect`'s
  user-scoped `connect("x/y")` OAuth requires `principalType === "user"` and would fail with
  `reason: "principal_required"` from an engine session. Irrelevant for PapaFlow (we decrypt our own
  connections inside the tool), but it rules out Vercel Connect for the Agent node.
- `vercelOidc()` would also work Vercel-to-Vercel with zero config, but it carries no `orgId`, so it
  cannot drive the per-session tool set. Use `jwtHmac()`.

---

## 5. `defineDynamic` — CONFIRMED exactly as planned

Per-session tools built from the authenticated org, proven live (a `console.log` in the resolver,
driven by a bearer for `org_zed`):

```
[spike] connectors resolver ran for orgId=org_zed -> telegram_send,slack_send
```

Naming rule confirmed from `guides/dynamic-capabilities.md`: a map "names each entry by its **bare
key** — there is no automatic slug prefix", and a dynamic name **overrides** a same-named authored
tool, while two dynamic resolvers emitting the same name throws. Closure values "must be
JSON-serializable" — a captured `connectionId` string is fine, a decrypted key would be persisted in
the durable descriptor.

### Model selection — CONFIRMED verbatim

`agent-config.md`, "Choose the model dynamically":

> **Serialization.** Session/turn selections must be model id strings; return live `LanguageModel`
> objects only from `step.started`.

and

> **Scopes.** `session.started` (once per session), `turn.started` (once per turn), `step.started`
> (every model step). Precedence: step > turn > session. Prefer `session.started`: prompt caches are
> per model, so every switch re-ingests the conversation at uncached prices.

Both handlers ran in the spike agent; the stream reported
`{"type":"step.started","data":{"modelId":"openai/gpt-5.6-luna-fast", ...}}`, i.e. the `step.started`
result won over the `session.started` string, exactly as the precedence rule says.

**New constraint found the hard way:** a provider package imported (even via `await import(...)`) from
an authored module must be an installed app dependency, or compilation fails:

```
[plugin eve-runtime-loader-package-boundary]
Error: Cannot resolve package "@ai-sdk/anthropic" imported from ".../agents/runtime/agent.ts".
```

So the BYOK `step.started` handler forces `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`
etc. to be real dependencies of the app (they already are in `docs/research/versions.md`).

Default model when `agent.ts` is absent is `openai/gpt-5.6-luna-fast`; when `agent.ts` is present,
`model` is required.

---

## 6. Durable tool + `ask()` — CONFIRMED (signature verbatim)

```ts
// node_modules/eve/dist/src/public/workflow/index.d.ts
export { ask } from "#execution/tool-run/messages.js";
export type { ToolInputRequest, ToolInputResponse } from "#tools/definition.js";

// node_modules/eve/dist/src/execution/tool-run/messages.d.ts:63-69
/**
 * Asks the human on the session's channel and returns the hook the answer
 * resumes, as `createHook` would: await it for the answer, or race it against
 * a `sleep` for a deadline. Synchronous because a `Hook` is thenable: an async
 * `ask` would resolve to the answer, never the hook.
 */
export declare function ask(ctx: ToolContext, request: ToolInputRequest): Hook<ToolInputResponse>;

// node_modules/eve/dist/src/tools/definition.d.ts:59-77
export interface ToolInputRequest {
    readonly allowFreeform?: boolean;
    readonly display?: "confirmation" | "select" | "text";
    readonly options?: readonly InputOption[];
    readonly prompt: string;
}
export interface ToolInputResponse {
    readonly optionId?: string;
    readonly text?: string;
}
```

The tool compiled and registered as a real workflow — from the compiled manifest:

```json
{ "name": "request_connection",
  "behavior": { "handling": { "kind": "workflow-tool",
    "workflowId": "workflow//./agents/runtime/tools/request_connection//execute" } } }
```

**Correction to the plan's snippet:** the timeout race is `sleep(...)` resolving to **`undefined`**,
not to a fabricated `{ optionId: "cancel" }`. `tools/workflows.mdx` shows the idiom:

```ts
const pending = ask(ctx, { prompt: `Deploy ${service}?`, options: APPROVE_OR_CANCEL });
const answer = await Promise.race([pending, sleep("4h")]);
if (answer === undefined) return { deployed: false, reason: "timed out" };
```

Rules quoted from `tools/workflows.mdx` that Phase 12 must respect:
- `"use workflow"` "goes on its own line as the first statement of `execute`, or of a top-level
  `async function` you reference as `execute: deploy`."
- "In the body, `ctx` has `session`, `callId`, `toolName`, and `abortSignal`. `getSandbox`,
  `getSkill`, `getToken`, and `requireAuth` throw there; read credentials in a step instead."
- "Workflow bodies are for static tools under `agent/tools/`, not tools returned from `defineDynamic`
  resolvers." (CLAUDE.md rule 8 stands.)
- "The workflow id derives from the tool's path, so renaming or moving the file creates a new
  workflow." — same don't-rename rule as `runNode`/`runGraph`, now applying to eve tool files too.
- `execution: "background"` needs `experimental.tasks` on the root agent.

**Not exercised:** the live `ask()` round trip needs a model call to invoke the tool. Compilation,
workflow registration and the `input.requested`/`respond()` protocol are confirmed; the actual
park-and-resume is Phase 12's first manual check.

---

## 7. Built-in tools — **new, and security-relevant**

An agent with zero authored tools already exposes twelve. `eve info` on the spike agent listed:

```
bash, read_file, write_file, todo, web_fetch, load_skill, ask_question,
web_search, agent, task_update, task_cancel, request_connection
```

`bash` is `"Execute a shell command in the shared workspace environment."` with
`"requiresApproval": false`. The docs are explicit:

> Review these default tools before production use. Disable, wrap, restrict, or require approval for
> any tool that can access the filesystem, network, shell, or sensitive data.

Disabling is one file per tool (tested — `bash` disappeared from the compiled manifest):

```ts
// agents/runtime/tools/bash.ts
import { disableTool } from "eve/tools";
export default disableTool();
```

**Add to Phase 10 Task 2:** `agents/runtime/tools/{bash,read_file,write_file,web_fetch,agent}.ts`
each exporting `disableTool()`. A workflow-automation agent running a customer's prompt has no
business with a shell, a filesystem or arbitrary URL fetches. Keep `ask_question` (it is the default
HITL widget) and `load_skill`.

Also new: `eve` ships a default `ask_question` tool with `{ prompt, options?, allowFreeform? }`, so
the Builder only needs a custom `request_connection` because it wants its own widget — not because
asking is unsupported.

---

## 8. `eve/client` — CONFIRMED

Run against the live dev server (`scripts/client.mts`):

```
health: { ok: true, status: 'ready', workflowId: 'workflow//eve//workflowEntry' }
result.status: failed
result keys: [ 'data', 'events', 'inputRequests', 'message', 'sessionId', 'status' ]
```

```ts
import { Client } from "eve/client";

const client = new Client({
  host: `${process.env.APP_ORIGIN}/eve/agents/runtime`,   // client appends /eve/v1/...
  auth: { bearer: async () => mintEngineToken(orgId, planSlug, executionId) },
  redirect: "manual",     // stops fetch forwarding auth headers cross-origin
});

const { session, response } = await client.sessions.create<Out>({ message, outputSchema });
const result = await response.result();
```

`MessageResult` (`node_modules/eve/dist/src/client/types.d.ts:211`):

```ts
export interface MessageResult<TOutput = unknown> {
    readonly data: TOutput | undefined;
    readonly message: string | undefined;
    readonly events: MessageStreamEvent[];
    readonly inputRequests: readonly InputRequest[];
    readonly sessionId: string;
    readonly status: "completed" | "failed" | "waiting";
}
```

Two additions the plan did not have: `inputRequests` (so the Agent node can detect a parked HITL ask
and fail the node with a useful message instead of hanging), and `events` — which is where Task 3's
"tool calls appear as sub-rows" comes from. There is **no** `session.id` property; use
`result.sessionId`.

HTTP contract, measured: `POST .../eve/v1/session` returns **202**
`{"ok":true,"sessionId":"wrun_...","status":"accepted"}`. (The older research note about a
`continuationToken` is stale for 0.49.0 — session routes "use only durable session IDs".)

---

## 9. Health route + mount path — CONFIRMED

`GET /eve/agents/runtime/eve/v1/health` → `200`. `GET /eve/v1/health` (unnamed form) → `404` when
`agents` is used. Health is public and skips the auth walk; `/eve/v1/info` uses the auth policy
(returned 200 in dev via `localDev()`).

Full route set owned by `channels/eve.ts` (from the compiled manifest and `channels/eve.mdx`):
`/eve/v1/health`, `/eve/v1/info`, `/eve/v1/session`, `/eve/v1/session/:sessionId`,
`/eve/v1/session/:sessionId/{cancel,clear,compact,reset,stream}`, plus
`/eve/v1/connections/:name/callback/...`.

---

## 10. Vercel Build Output — CONFIRMED (spike item 6)

`vercel build` needs a linked project, which I did not create. Instead I dropped a
`.vercel/project.json` marker and ran `next build`; `withEve` took the linked-project code path and
wrote `.vercel/output/config.json`:

```json
{
  "services": {
    "eve-runtime": {
      "framework": "eve",
      "root": ".eve/vercel-services/eve-runtime",
      "routePrefix": "/eve/agents/runtime",
      "buildCommand": "cd '../../../agents/runtime' && export EVE_INTERNAL_BUILD_OUTPUT_DIRECTORY=... && export EVE_PUBLIC_ROUTE_PREFIX='/eve/agents/runtime' && node '.../eve/bin/eve.js' build",
      "routes": [{ "src": "^/eve/agents/runtime/eve/v1/(.*)$",
                   "transforms": [{ "op": "set", "type": "request.path", "args": "/eve/v1/$1" }] }]
    }
  },
  "routes": [{ "src": "^/eve/agents/runtime/eve/v1/(.*)$",
               "destination": { "type": "service", "service": "eve-runtime" } }]
}
```

and the same `next build` emitted the Workflow SDK routes as ordinary Next functions:

```
├ ƒ /.well-known/workflow/v1/flow
├ ƒ /.well-known/workflow/v1/webhook/[token]
└ ƒ /api/start
```

Both surfaces coexist in one build. Note the route regex is `^/eve/agents/runtime/eve/v1/(.*)$` — only
the `/eve/v1/*` sub-path is service-routed; a bare `/eve/agents/runtime/` is still a Next 404.

---

## 11. `proxy.ts` matcher — CONFIRMED, and now measured

In dev the eve routes are Next rewrites, so `proxy.ts` **does** see them. With `matcher: ["/(.*)"]`:

```
[spike] proxy saw: /eve/agents/runtime/eve/v1/health
[spike] proxy saw: /.well-known/workflow/v1/flow
```

With the repo's existing matcher (`/((?!_next|\.well-known/workflow/|eve/)…)`), neither path reaches
the proxy — only `/` and `/api/start` did. On Vercel the service route runs before filesystem routing,
so middleware never sees `/eve/**` there; the exclusion is what makes dev match prod. **The repo's
`proxy.ts` is already correct — no change needed in Phase 10.**

---

## 12. Node / Next / toolchain constraints

- **Node ≥ 24** — `eve` `engines: { node: ">=24" }`, `"type": "module"` (ESM-only). Repo already
  pins `"engines": { "node": "24.x" }`. Ran on v24.14.1.
- **Peer** `ai ^7.0.82` — `ai@7.0.90` satisfies it.
- **Turbopack** — dev and build both ran under Turbopack with no config; `withWorkflow`'s
  `runAfterProductionCompile` fired.
- **`agentRules` side effect (Next 16, not eve).** `next dev` writes AI-agent rules into the repo:
  with no `CLAUDE.md` it creates `AGENTS.md` + a `CLAUDE.md` containing `@AGENTS.md`; with an existing
  `CLAUDE.md` it **appends** a `<!-- BEGIN:nextjs-agent-rules -->` block to it. `next build` does not.
  **The repo already sets `agentRules: false` in `next.config.mts` — keep that line when wrapping with
  `withEve`.**
- **`next dev` rewrites TypeScript config.** It auto-added `.next/dev/types/**/*.ts` to `include`,
  forced `jsx: "react-jsx"`, and — on a project with no `typescript` dependency — installed
  `typescript@7.0.2`, which the repo forbids. The repo already pins `typescript@5.9.3`, so this is a
  non-issue there; just do not let a fresh install resolve TS itself.
- **`workflow` inside eve tools.** `eve/workflow-modules` declares:
  > Types for the `workflow` specifiers eve resolves to its vendored SDK. Ambient, so an installed
  > `workflow` package takes precedence.

  i.e. `import { sleep } from "workflow"` inside a tool runs against **eve's vendored** SDK while the
  types come from the app's installed `workflow`. eve 0.49.0 vendors `@workflow/*` at
  `5.0.0-beta.47` — the exact version the repo pins, so they agree today. Watch this on any eve bump:
  a vendored-SDK jump could silently diverge from `workflow@5.0.0-beta.47`. Because the repo installs
  `workflow`, the `"types": ["eve/workflow-modules"]` tsconfig entry is optional.
- `tsc --noEmit` is clean over the whole spike, including the durable tool, the dynamic tools, the
  channel and the client script.

---

## 13. Chat-panel HITL (Phase 12 preview) — one correction

`eve/react` exports `useEveAgent({ agent: "builder", headers })`; `agent` targets
`/eve/agents/builder/eve/v1/...` with no `host`. Answer with `agent.respond([...])`.

The documented detection pattern (`guides/frontend/overview.mdx`):

```tsx
const pendingRequests = agent.data.messages
  .flatMap((message) => message.parts)
  .flatMap((part) => {
    if (part.type !== "dynamic-tool" || part.state !== "approval-requested") return [];
    const request = part.toolMetadata?.eve?.inputRequest;
    return request ? [request] : [];
  });

await agent.respond([{ requestId: request.requestId, optionId: option.id }]);
// freeform: { requestId, text }
```

**Correction:** the React projection `EveMessageInputRequest` has **no `action` field** — the research
doc's `part.toolMetadata.eve.inputRequest.action.toolName` does not exist on the client type. Match
the widget on **`part.toolName === "request_connection"`** instead. (The *protocol* `InputRequest` —
what `MessageResult.inputRequests` and the raw `input.requested` event carry — does have
`action: { callId, input, kind: "tool-call", toolName }`. Two different types, same idea.)
`request.kind` is `"question" | "session-limit" | "tool-approval"`; an `ask()` from a durable tool is
`"question"`.

---

## Replacement text for the repo

### CLAUDE.md rule 8 — replace the existing paragraph with

> 8. **eve constraints**: durable tools (those that call `ask()`, `sleep`, `createHook`) must be static
>    files under `agents/<name>/tools/`, never returned from `defineDynamic`. The directory named in
>    `withEve({ agents })` **is** the agent root (flat layout: `agent.ts`, `instructions.md`, `tools/`,
>    `channels/` directly inside; no nested `agent/`) and needs no `package.json`. `ask(ctx, req)` is
>    synchronous and returns a thenable Hook — `await` it, or `Promise.race` it with `sleep`, where the
>    sleep branch resolves to `undefined`. `defineDynamic` model handlers on `session.started`/
>    `turn.started` must return model-ID strings; a live AI SDK model built from the org's key may only
>    be returned from `step.started`, and any provider package it imports must be an app dependency.
>    Every agent needs `channels/eve.ts` with `eveChannel({ auth: [...] })` — production rejects every
>    session request without one. `SessionAuthContext.attributes` is required and its values must be
>    strings or string arrays. Browser callers authenticate with a custom Clerk `AuthFn`
>    (`principalType: "user"`); the engine authenticates with `jwtHmac()` over a short-lived
>    `ENGINE_SECRET`-signed token whose custom claims land in `ctx.session.auth.current.attributes`.
>    Disable the default `bash`/`read_file`/`write_file`/`web_fetch`/`agent` tools with `disableTool()`.
>    Every Builder tool checks the org's plan in Convex inside `execute`. Builder tools edit workflows
>    only; Runtime agent tools call connectors only.

### docs/PLAN.md line 329 — replace the wrapper-order caveat

> `next.config.mts` with `withEve(withWorkflow(nextConfig), { agents })` (spiked 2026-09-02: both
> wrapper orders work in `next dev` and `next build`, and `.mts` is not required — Next 16.3.4 loads a
> plain `next.config.ts` with `eve/next` fine; keep `.mts` and this order anyway). Keep
> `agentRules: false` or `next dev` appends a Next.js agent-rules block to `CLAUDE.md`.

### docs/PLAN.md line 339 — replace the bearer-token sentence

> The Agent node's step uses `eve/client` with a bearer the step mints itself: a 5-minute HS256 JWT
> signed with `ENGINE_SECRET` carrying `orgId`, `plan` and `executionId`. The agent's `channels/eve.ts`
> verifies it with the shipped `jwtHmac()` authenticator, which projects those claims straight into
> `ctx.session.auth.current.attributes` (`principalType: "service"`). A separate Clerk `AuthFn` in the
> same walk handles browser callers as `principalType: "user"`. No Clerk token is minted server-side,
> and a user's session token never leaves the browser.

---

## Phase 10 implementation addendum (2026-09-03, measured in the repo)

Four things the spike could not see, found while landing the Runtime agent. All executed against
`eve@0.49.0` in `/Users/sonnysangha/Documents/Builds/n8n-clone-demo`.

### 1. Under `pnpm dev`, an unauthenticated session is **202**, not 401

`next dev` starts `eve dev`, which sets `EVE_DEV=1`, which makes `localDev()` the entry that wins the
auth walk. So the fail-closed behaviour in §3 is a *production* property and cannot be observed on a
dev server. Measured both ways on the finished agent:

| server | request | result |
|---|---|---|
| `next dev` (port 3000) | `GET /eve/agents/runtime/eve/v1/health` | `200 {"ok":true,"status":"ready",…}` |
| `next dev` | `POST …/eve/v1/session`, no auth | `202` (via `localDev()`) |
| `next dev` | `POST …/eve/v1/session`, `mintEngineToken()` bearer | `202` |
| `eve start`, `EVE_DEV` unset (port 3997) | `GET /eve/v1/health` | `200` |
| `eve start` | `POST /eve/v1/session`, no auth | `401`, `www-authenticate: Bearer` |
| `eve start` | `POST /eve/v1/session`, junk bearer | `401` |
| `eve start` | `POST /eve/v1/session`, `mintEngineToken()` bearer | `202` |

The last row is the one that matters: a token signed by `lib/eve.ts#mintEngineToken` is accepted by
`jwtHmac()` in a real deployment, and `tests/eve-token.test.ts` pins the same round trip by running
eve's own `jwtHmac()` over a fabricated `Request`.

### 2. A channel module is evaluated at **build** time

`eve build` evaluates `channels/eve.ts`, so reading a runtime secret at module scope turns a missing
build-time variable into a failed build:

```
Failed to evaluate authored module:
  agents/runtime/channels/eve.ts
  Caused by: runtime agent: ENGINE_SECRET is required to verify the engine's own token.
```

`jwtHmac({ secret })` therefore has to be constructed **inside** the `AuthFn`, per request, not once
at module load. Same rule applies to any authored module eve compiles.

### 3. A `skills/` directory makes the agent prewarm a sandbox at boot

Isolated by bisection: with `agents/runtime/skills/` present, `eve start` dies before listening —

```
eve: failed to initialize sandbox template "root" on backend "microsandbox":
  The microsandbox sandbox backend requires the `microsandbox` package, which is not bundled with eve.
```

— and with the directory moved away it starts and serves normally. Static markdown skills do not
*need* a sandbox (`load_skill` returns their body from the compiled agent), but the build still
registers a template for them and `eve start` prewarms it eagerly.

Consequences:
- **Local `eve dev` / `pnpm dev`: fine.** eve dev auto-installs microsandbox into the agent root
  (writing `agents/runtime/{package.json,node_modules/}` — both now `.gitignore`d as generated).
- **Local standalone `eve start`: needs microsandbox or Docker**, or the skills directory moved.
- **Vercel: works, but pays for it.** `defaultBackend()` picks Vercel Sandbox when `process.env.VERCEL`
  is set, so the Runtime service will prewarm a hosted sandbox for an agent whose `bash`,
  `read_file`, `write_file` tools are all disabled and whose tools never call `getSandbox()`.
  Not changed here (it is the default eve behaviour the spike validated); worth revisiting with
  `defineSandbox({ backend: justbash() })` if the prewarm shows up in cost or cold starts.

### 4. `@/…` imports from an authored module resolve against the root tsconfig

`agents/runtime/**` imports `@/lib/...` and `@/nodes/...` and compiles. The boundary plugin treats a
`@/`-prefixed specifier as a path import, not a package import
(`internal/authored-package-boundary.js`, `isPackageImport`), and
`internal/authored-package-tsconfig-paths.js` says outright: *"Rolldown handles the root app
tsconfig; this only fills the package-local config gap for sources outside the app root."*

The constraint this creates is on the **import graph**, not the syntax: whatever an authored module
reaches gets compiled into the agent bundle. `lib/engine-client.ts` imports `workflows/run-graph.ts`,
so the Runtime agent reaches Convex through `lib/connections-engine.ts` instead — the same
`ENGINE_SECRET` conversation with no `"use workflow"` module anywhere in its graph.
