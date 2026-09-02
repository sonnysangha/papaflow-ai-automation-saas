# Phase 5 — Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one fresh Opus subagent per task. Tests first for every signature verifier.

**Goal:** Webhook, Form, Telegram-inbound and Stripe-inbound triggers, all landing in `lib/engine-client.ts#startRun()`. Inbound routes are **per connection** so verification uses the user's own secret (SaaS model), and every signed route reads the raw body first.

**Architecture:** Trigger nodes only *describe* their inbound contract (URL shown in the config panel); Next.js route handlers do the verification and call `startRun`. `startRun` resolves the org's plan via `lib/billing.ts#getOrgPlan(orgId)` (Clerk Backend API, cached) because inbound routes have no session. Telegram and Stripe are connectors (Phase 4's `defineConnector`) whose `test()` validates the token and whose inbound URL is derived from the connection id.

**Spec:** master plan Phase 5 + Connection model, `docs/PLAN.md` "Triggers" (lines 125-141), `docs/research/connectors-chat.md` (Telegram: `getMe`, `setWebhook` with `secret_token` → header `X-Telegram-Bot-Api-Secret-Token`, HTTPS ports 443/80/88/8443), `docs/research/connectors-data.md` (Stripe: `Stripe-Signature` `t=…,v1=…`, HMAC-SHA256 over `${t}.${rawBody}`, 300 s tolerance, dedupe on `event.id`, Stripe CLI `stripe listen`/`stripe trigger`).

## Global constraints

- Signed webhooks: `const raw = await request.text()` first, verify with `crypto.timingSafeEqual` on equal-length buffers, then `JSON.parse`. Return 200 immediately after `startRun` (or 202) — never await the run.
- The webhook trigger secret lives on the workflow (`workflows.webhookSecret`); the URL is `${APP_ORIGIN}/api/hooks/${workflowId}/${webhookSecret}`; compare with a constant-time check.
- Per-connection inbound URLs: `${APP_ORIGIN}/api/events/telegram/${connectionId}`, `${APP_ORIGIN}/api/events/stripe/${connectionId}`. `APP_ORIGIN` falls back to `https://${process.env.VERCEL_URL}` on previews.
- `lib/billing.ts#getOrgPlan(orgId)`: `const client = await clerkClient(); const sub = await client.billing.getOrganizationBillingSubscription(orgId)` → the `active` (or `past_due`) item's `plan.slug` → `isPlanSlug` else `free_org`; in-process TTL cache 60 s; on any error log and return `free_org`. Used by `startRun` for every trigger (the Manual server action passes the plan from `auth()` claims instead).
- Dedupe inbound deliveries in `webhookEvents` (`source: "stripe" | "github" | …`, `eventId`) via an engine-secret mutation before starting a run.

## File structure

```
lib/billing.ts                                getOrgPlan(orgId)
lib/engine-client.ts (mod)                    startRun accepts planSlug; snapshot on execution
lib/signatures/stripe.ts  lib/signatures/telegram.ts  lib/signatures/timing.ts
convex/engine.ts (mod)                        listWorkflowsByTrigger (secret: { orgId?, connectionId, triggerType }), recordWebhookEvent (dedupe), getWorkflowBySecret
convex/workflows.ts (mod)                     rotateWebhookSecret; index usage
nodes/triggers/webhook.ts  nodes/triggers/form.ts  nodes/triggers/telegram-message.ts  nodes/triggers/stripe-event.ts
connectors/telegram.ts  connectors/stripe.ts
app/api/hooks/[workflowId]/[secret]/route.ts
app/f/[workflowId]/page.tsx  app/api/forms/[workflowId]/route.ts  components/forms/PublicForm.tsx
app/api/events/telegram/[connectionId]/route.ts
app/api/events/stripe/[connectionId]/route.ts
components/canvas/fields/TriggerUrl.tsx       read-only URL + copy button + "rotate secret"
tests/signatures.test.ts  tests/billing.test.ts  convex/engine-triggers.test.ts
```

### Task 1: Plan resolution for session-less triggers + webhook trigger

- [ ] `lib/billing.ts` (+ `tests/billing.test.ts` mocking `@clerk/nextjs/server`'s `clerkClient`): active pro item → `pro`; no items → `free_org`; API error → `free_org`; second call within 60 s does not hit the API.
- [ ] `startRun` gains `planSlug` (callers pass it; `executions.planSlug` stored) and `convex/engine.ts#getWorkflowBySecret({ secret, workflowId, webhookSecret })` (constant-time compare inside the mutation is not possible — compare in the route, the query only returns the doc for the id and the route compares) — simpler: `getWorkflowForRun` already returns `webhookSecret`; the route compares with `timingSafeEqual`.
- [ ] `nodes/triggers/webhook.ts` (`webhook.trigger`, icon `Webhook`): inputs `{}` (URL is derived), outputs `{ body: z.any(), headers: z.record(z.string(), z.string()), query: z.record(z.string(), z.string()), method: z.string() }`. Route `app/api/hooks/[workflowId]/[secret]/route.ts` (GET and POST): load the workflow via the engine client, constant-time compare the secret, build the payload, `startRun({ orgId: wf.orgId, workflowId, trigger: { type: "webhook", payload }, planSlug: await getOrgPlan(wf.orgId) })`, respond `202 { executionId }`. `TriggerUrl` field in the config panel shows the URL with copy + rotate (`workflows.rotateWebhookSecret`).
- [ ] Verify: `curl -X POST http://localhost:3000/api/hooks/<id>/<secret> -H 'content-type: application/json' -d '{"hello":"world"}'` → run starts and the trigger output shows the body. Commit `feat(triggers): webhook trigger with per-workflow secret and session-less plan lookup`.

### Task 2: Form trigger

- [ ] `nodes/triggers/form.ts` (`form.trigger`, icon `ClipboardList`): inputs `{ title: z.string().default("Contact us"), fields: z.array(z.object({ name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), label: z.string(), type: z.enum(["text","email","textarea","number","select"]), required: z.boolean().default(true), options: z.array(z.string()).optional() })).min(1), submitLabel: z.string().default("Send") }`, outputs `{ values: z.record(z.string(), z.any()), submittedAt: z.number() }`.
- [ ] `app/f/[workflowId]/page.tsx` (public, no auth; `proxy.ts` leaves it unprotected by design): server component loads the workflow's form spec via an engine-secret query `getPublicForm({ workflowId })` (returns only the form node's inputs + name; 404 when the workflow has no form trigger or is not `active`/`draft`), renders `<PublicForm>` (client) → `POST /api/forms/[workflowId]` → zod-validate against the spec → `startRun` with `trigger: { type: "form", payload: { values, submittedAt } }` → `{ ok: true }`; the page shows a thank-you state. Basic abuse guard: 10 submissions / minute / IP in-memory (note for later: Turnstile).
- [ ] Verify: submit the public form in the browser → run starts. Commit `feat(triggers): hosted public form trigger`.

### Task 3: Telegram connector + inbound trigger

- [ ] `connectors/telegram.ts` (`provider: "telegram"`, kind `botToken`, category `chat`, field `botToken`): `test()` → `GET https://api.telegram.org/bot<token>/getMe` → `{ ok: true, label: "@<username>", hint, meta: { bot_username, bot_id } }`. After the connection is created, `/api/connections` calls `connector.afterCreate?.(connectionId, secret)` → for Telegram: generate `secretToken` (32 random base64url chars), `POST setWebhook` with `{ url: ${APP_ORIGIN}/api/events/telegram/${connectionId}, secret_token }`, store `secretToken` INSIDE the sealed secret (re-seal `{ botToken, secretToken }`) and `meta.webhookSet = true`. Add `afterCreate` to `ConnectorDef` (optional).
- [ ] `lib/signatures/telegram.ts#verifyTelegram(request, secretToken)` compares `X-Telegram-Bot-Api-Secret-Token` (constant-time). Route `app/api/events/telegram/[connectionId]/route.ts`: `getConnectionSealed` → `open` → verify → parse update → learn `chat_id`s into `meta.chat_ids` (`{ id, title|first_name, type }`, engine-secret `updateConnectionMeta`) → find workflows whose trigger node is `telegram.message` with `inputs.connectionId === connectionId` (`listWorkflowsByTrigger`) → `startRun` each → 200.
- [ ] `nodes/triggers/telegram-message.ts` (`telegram.message`, icon `Send`, `credential: "telegram"`): inputs `{ connectionId: z.string() }`, outputs `{ update: z.any(), chatId: z.string(), text: z.string().optional(), from: z.any() }`.
- [ ] Verify with the user's bot connection: message the bot from a phone → run starts with the update as payload (requires `APP_ORIGIN` to be the deployed HTTPS origin or a tunnel). Commit `feat(triggers): telegram inbound via per-connection setWebhook secret`.

### Task 4: Stripe connector + inbound trigger (+ tests)

- [ ] `lib/signatures/stripe.ts#verifyStripe(rawBody, header, secret, toleranceSeconds = 300)`: parse `t=` and all `v1=` values; `expected = HMAC-SHA256(secret, `${t}.${rawBody}`)` hex; constant-time compare against any `v1`; reject when `|now - t| > tolerance`. Tests with a known vector (compute the signature in the test with Node crypto) + tampered body + expired timestamp.
- [ ] `connectors/stripe.ts` (`provider: "stripe"`, kind `signingSecret`, category `payments`, field `signingSecret` (`whsec_…`)): `test()` cannot call Stripe (no API key) → `{ ok: true, label: "Stripe webhook", hint, meta: { verified: false } }`; the connection row shows the inbound URL to paste into Stripe (`${APP_ORIGIN}/api/events/stripe/${connectionId}`); first verified delivery flips `meta.verified = true`.
- [ ] Route `app/api/events/stripe/[connectionId]/route.ts`: raw body → `open` secret → `verifyStripe` (400 on failure) → dedupe `recordWebhookEvent({ source: "stripe", eventId: event.id })` (200 if duplicate) → workflows with trigger `stripe.event` for this connection whose `inputs.eventTypes` is empty or includes `event.type` → `startRun` → 200.
- [ ] `nodes/triggers/stripe-event.ts` (`stripe.event`, icon `CreditCard`, `credential: "stripe"`): inputs `{ connectionId: z.string(), eventTypes: z.array(z.string()).default([]) }`, outputs `{ event: z.any(), type: z.string(), object: z.any() }`.
- [ ] Verify: `stripe listen --forward-to localhost:3000/api/events/stripe/<connectionId>` (prints a `whsec_` the user pastes into the Stripe connection) then `stripe trigger payment_intent.succeeded` → one run, redelivery deduped. Commit `feat(triggers): stripe events with per-connection signing secret and dedupe`.

### Phase check

All four triggers start runs that appear on the runs page with the right trigger type; `pnpm typecheck && pnpm lint && pnpm test` green; a preview deployment (push) exposes the public URLs for Telegram/Stripe.
