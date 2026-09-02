# Phase 4 — Vault, Connections, AI Connectors, AI Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one fresh Opus subagent per task. Tests first.

**Goal:** Users add their own credentials as per-organisation **connections** inside the app (SaaS, bring-your-own). Secrets are sealed with AES-256-GCM before they reach Convex and opened only inside `"use step"` code. Ten AI providers are validated with their list-models endpoint and the model list is cached on the connection. LLM / Extract / Classify nodes run with the org's key through AI SDK 7 provider factories.

**Architecture:** `connectors/<provider>.ts` (`defineConnector`) describes how a user connects (form fields, `test()`, `discover()`), separate from `nodes/`. `POST /api/connections` runs `test()`, inserts the row via an engine-secret mutation to obtain the id, seals the secret with AAD `${orgId}:${connectionId}`, and patches the row. Convex queries project safe fields only. `runNode` opens the credential via `vault.openFresh(connectionId)` inside the step and gates `requiresFeature` against the execution's `planSlug`.

**Spec:** master plan (`Connection model`, `Phase 4`), CLAUDE.md rules 1, 2, 11, `docs/PLAN.md` "AI connectors" and "Credential vault", `docs/research/ai-sdk.md` (provider→validate/list table, factories, Output API), `docs/research/connectors-data.md` (Node crypto call order verified on Node 24).

## Global constraints

- Secrets: never in a Convex query result, a step argument, a step return value, a log line, a toast, or the Builder's tool results. `redact()` is applied to every stored `input`.
- Vault: `seal(plaintext: object, aad: string)` → `{ v: 1, keyId: "k1", iv, tag, ct }` (base64), `open(sealed, aad)`; KEK = 32 bytes base64 from `CREDENTIALS_KEK`; fresh 12-byte IV per row; `setAAD` before `update`, `getAuthTag` after `final`; `setAuthTag` before `final` on decrypt. AAD is always `${orgId}:${connectionId}`.
- Anthropic 5-series: never pass `temperature`/`topP`/`topK` or `toolChoice: "required"`; `Output.choice({ options })` for Classify; `Output.object({ schema })` for Extract; read `result.output`.
- Model ids are never hardcoded in UI; the picker reads `connection.meta.models` captured by `discover()` at connect time (and "refresh models" re-runs it).
- Plan gating: `requiresFeature` on a connector/node is checked with `has({ feature: "org:<slug>" })` in `/api/connections` and against `execution.planSlug` in `runNode`.

## File structure

```
lib/vault.ts                                 seal/open, openFresh(connectionId) (step-side; refresh in Phase 7)
lib/ai/providers.ts                          providerFor(provider, apiKey)
lib/ai/validate.ts                           validateAndDiscover(provider, secret) using the verified endpoint table
lib/redact.ts (Phase 2)                      reused
connectors/define.ts                         defineConnector, ConnectorDef, FieldSpec, ConnectorTestResult
connectors/registry.ts                       CONNECTORS, connectorCatalogue()
connectors/{openai,anthropic,google,xai,mistral,groq,deepseek,openrouter,elevenlabs,fal}.ts
convex/connections.ts                        list (projected), get (projected), internal create/patchSecret/setStatus/remove; engine: getSecret (secret-checked, returns sealed blob + orgId)
convex/engine.ts (mod)                       getConnectionSealed for steps
app/api/connections/route.ts                 POST create (test → insert → seal → patch)
app/api/connections/[id]/route.ts            DELETE; POST { action: "retest" | "refresh" }
app/(app)/connections/page.tsx               page
components/connections/{ConnectionList,AddConnectionDialog,ProviderPicker,ConnectionPicker}.tsx
components/canvas/fields/ConnectionField.tsx  node config: pick a connection of the node's credential kind
nodes/ai/{llm,extract,classify}.ts
workflows/steps/run-node.ts (mod)            vault.openFresh + feature gate
tests/vault.test.ts  tests/validate.test.ts  tests/ai-nodes.test.ts  convex/connections.test.ts
```

### Task 1: Vault (+ tests)

- [ ] Tests first (`tests/vault.test.ts`, set `process.env.CREDENTIALS_KEK` to a random 32-byte base64 in `beforeAll`): round-trip object; different IV each seal; wrong AAD throws; tampered `tag`/`ct` throws; missing/short KEK throws a clear error. Implement `lib/vault.ts` per PLAN.md lines 232-253 (with `aad = ${orgId}:${connectionId}`). `openFresh(connectionId)` (used by steps): calls `engine.getConnectionSealed({ connectionId })` (secret-checked query returning `{ orgId, provider, kind, secret, expiresAt, status }`), throws `FatalError("connection <status>")` unless `active`, then `open(secret, aad)`; refresh logic is added in Phase 7. Commit `feat(vault): aes-256-gcm seal/open with org-bound aad`.

### Task 2: Connector definitions + AI provider validation (+ tests)

- [ ] `connectors/define.ts`:

```ts
export type FieldSpec = { name: string; label: string; kind: "secret" | "text" | "url"; placeholder?: string; help?: string; required?: boolean };
export type ConnectorDef = {
  provider: string; name: string; category: "ai" | "chat" | "data" | "email" | "payments";
  kind: "apiKey" | "botToken" | "webhookUrl" | "signingSecret" | "oauth2";
  requiresFeature: string | null; fields: FieldSpec[]; docsUrl: string;
  test: (secret: Record<string, string>) => Promise<{ ok: true; label: string; hint: string; meta: Record<string, unknown> } | { ok: false; error: string }>;
};
```

`hint` = last 4 chars of the primary secret. AI connectors (all `kind: "apiKey"`, `category: "ai"`, `requiresFeature: null`, single field `apiKey`): implement `test()` via `lib/ai/validate.ts#validateAndDiscover(provider, apiKey)` using EXACTLY the verified table in `docs/research/ai-sdk.md` (OpenAI `GET https://api.openai.com/v1/models` → `data[].id`; Anthropic `GET https://api.anthropic.com/v1/models?limit=1000` headers `x-api-key` + `anthropic-version: 2023-06-01` → `data[].id`; Google `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000` header `x-goog-api-key` → `models[].name` minus `models/`, keep those whose `supportedGenerationMethods` include `generateContent`; xAI `GET https://api.x.ai/v1/api-key` (reject when `api_key_blocked|api_key_disabled|team_blocked`) then `GET /v1/language-models` → `models[].id`; Mistral `GET https://api.mistral.ai/v1/models` → `data[]` filtered `capabilities.completion_chat` → `id`; Groq `GET https://api.groq.com/openai/v1/models` → `data[].id`; DeepSeek `GET https://api.deepseek.com/models` → `data[].id`; OpenRouter `GET https://openrouter.ai/api/v1/key` (validate) + `GET https://openrouter.ai/api/v1/models` → `data[].id`; ElevenLabs `GET https://api.elevenlabs.io/v1/user` header `xi-api-key` (validate) + `GET /v1/models` → `[].model_id` filtered `can_do_text_to_speech`; fal `POST https://fal.run/fal-ai/flux/schnell` header `Authorization: Key …` with a 1-image square prompt — 401 = invalid key, 2xx = valid; models list `GET https://api.fal.ai/v1/models?status=active&limit=50` → `models[].endpoint_id`). `meta = { models: string[], fetchedAt }`, `label` defaults to `"<Provider> (<hint>)"`. 
- [ ] Tests (`tests/validate.test.ts`) with `vi.stubGlobal("fetch")`: each provider's request URL + auth header name and the parsed model list; 401 → `{ ok: false }`. Commit `feat(connectors): connector definitions and ai provider validation`.

### Task 3: Convex connections + API routes (+ tests)

- [ ] `convex/connections.ts`: `list` query → `requireOrg` → rows for the org projected to `{ _id, provider, kind, label, hint, status, scopes, meta: { models? , … non-secret }, requiresFeature, expiresAt, updatedAt, createdBy }` — NEVER `secret`; `get` (same projection); internal `create` (inserts with a placeholder `secret = { v: 1, keyId: "pending", iv: "", tag: "", ct: "" }` and returns the id), `patchSecret`, `setStatus`, `remove`; engine-secret public functions in `convex/engine.ts`: `createConnection`, `patchConnectionSecret`, `getConnectionSealed` (query), `removeConnection`. convex-test: `list` never includes `secret`; cross-org `get` throws; `getConnectionSealed` with a wrong secret throws.
- [ ] `app/api/connections/route.ts` (POST): `const { isAuthenticated, orgId, userId, has } = await auth()`; body `{ provider, label?, secret: Record<string,string> }` validated with zod; `def = CONNECTORS[provider]`; `if (def.requiresFeature && !has({ feature: "org:" + def.requiresFeature })) → 403 { code: "upgrade_required" }`; `test()` → 400 with the error on failure; `id = createConnection({ orgId, createdBy: userId, provider, kind, label, hint, meta, requiresFeature })`; `sealed = seal(secret, `${orgId}:${id}`)`; `patchConnectionSecret({ id, sealed })`; respond `{ id, label }`. Never echo the secret. `[id]/route.ts`: DELETE (org check) and POST `{ action }` (`retest`/`refresh` → open the secret server-side, re-run `test()`, update `meta`/`status`).
- [ ] Commit `feat(connections): org-scoped connection storage with projected queries and create/test routes`.

### Task 4: Connections UI

- [ ] `app/(app)/connections/page.tsx` + `ConnectionList` (`<Table>`: provider icon/name, label, `••••hint`, status `<Badge>`, models count, updated; row menu: Re-test, Refresh models, Delete with confirm) + `AddConnectionDialog` (`ProviderPicker` grouped by category from `connectorCatalogue()`; dimmed + "Pro" badge when `requiresFeature` not in `plan.features`; form from `fields` (secret fields are `type="password"`), "Test & save" → `POST /api/connections`, success toast, error inline). `ConnectionPicker` (Select of the org's connections filtered by `provider`/`kind`) and `components/canvas/fields/ConnectionField.tsx` for node config (`def.credential`). Commit `feat(connections): connections page and add dialog`.

### Task 5: AI nodes + runNode credential opening (+ tests)

- [ ] `lib/ai/providers.ts#providerFor(provider, apiKey)` exactly as in `docs/research/ai-sdk.md` (`createOpenAI`, `createAnthropic`, `createGoogle`, `createXai`, `createMistral`, `createGroq`, `createDeepSeek`, `createOpenRouter`). Nodes (category `ai`, `credential: "ai"` meaning any AI connection; `requiresFeature: null`):
  - `ai.llm` (icon `Sparkles`): inputs `{ connectionId: z.string(), model: z.string(), instructions: z.string().optional(), prompt: z.string().min(1), maxOutputTokens: z.number().int().positive().default(1024), temperature: z.number().min(0).max(2).optional() }`, outputs `{ text: z.string(), finishReason: z.string(), usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).partial() }`; `run` → `generateText({ model: providerFor(p, key)(model), instructions, prompt, maxOutputTokens, ...(provider !== "anthropic" && temperature !== undefined ? { temperature } : {}) })`.
  - `ai.extract` (icon `ScanText`): inputs `{ connectionId, model, prompt: z.string(), fields: z.array(z.object({ name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), type: z.enum(["string","number","boolean","string[]"]), description: z.string().optional() })).min(1) }`, outputs `z.record(z.string(), z.any())`; build a zod object from `fields`, `generateText({ …, output: Output.object({ schema }) })` → `result.output`.
  - `ai.classify` (icon `Tags`): inputs `{ connectionId, model, text: z.string(), labels: z.array(z.string().min(1)).min(2), instructions: z.string().optional() }`, outputs `{ label: z.string() }`; `Output.choice({ options: labels })`.
  The node's `credential` field tells `runNode` which connection kind the config panel offers; `connectionId` arrives in `node.data.inputs`. `runNode`: when `def.credential`, `credential = await openFresh(inputs.connectionId)` (asserting the connection's `orgId === execution.orgId`), and refuse when `def.requiresFeature` or the connection's `requiresFeature` is missing from `featuresForPlan(execution.planSlug)` → `FatalError("Upgrade required: <feature>")`.
- [ ] Tests (`tests/ai-nodes.test.ts`) mock `ai`'s `generateText` with `vi.mock("ai", …)`: LLM omits `temperature` for anthropic and passes it for openai; Extract builds the schema and returns `output`; Classify passes `Output.choice` options. Commit `feat(ai): llm, extract, classify nodes with byok providers`.

### Phase check

Add an Anthropic key on the Connections page (the user pastes their own key into the dialog) → model list fills → LLM node summarises the HTTP output → swap the connection to an OpenAI or Groq key → same workflow runs; Convex data view shows only ciphertext for `connections.secret`; the `connections.list` payload in the Network panel has no `secret`; `pnpm typecheck && pnpm lint && pnpm test` green.
