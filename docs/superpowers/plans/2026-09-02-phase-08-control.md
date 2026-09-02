# Phase 8 — Control Nodes Implementation Plan (Wait, Approval, Wait-for-webhook, Loop)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one fresh Opus subagent per task. Tests first for signature verifiers and the graph/loop logic.

**Goal:** Wait (`sleep()` — no compute while waiting), Approval (buttons in Slack, Discord or Telegram → `createHook()` → the run suspends → the interactivity route calls `resumeHook()`), Wait-for-webhook (a URL containing the token; a later POST resumes the run with its body), and Loop (sequential per item in v1 with `{{ $item }}`).

**Architecture:** Nodes return `control` (`{ kind: "sleep", ms }` or `{ kind: "hook" }`); `runGraph` already handles both (Phase 2). The hook token is deterministic: `${executionId}:${nodeId}`; `runNode` stores it on the step row (`hookToken`) with status `waiting`. Resume routes verify the provider's signature using the **connection's own secret** (SaaS model), look up the step by `by_hookToken`, and call `resumeHook(token, payload)` from `workflow/api` (allowed in route handlers). `recordResume` (Phase 2) marks the step `success` with the payload as output; `handle` is derived from the payload (`approved` → "approved" | "rejected").

**Verified SDK facts (docs/research/workflow-sdk.md + installed docs):** `sleep("30s" | ms | Date)` in workflow bodies only, no maximum; `using hook = createHook<T>({ token })` in workflow bodies only, token ≤ 255 bytes, `await hook` returns the first payload; `resumeHook(token, payload)` from "workflow/api" in routes/steps; `HookNotFoundError.is(err)` from "workflow/errors"; `getRun(runId).cancel()`.

**Verified provider facts (docs/research/connectors-chat.md):** Slack interactivity POST is `application/x-www-form-urlencoded` with `payload=<json>`; signature `v0:{ts}:{rawBody}` HMAC-SHA256 with the signing secret, header `X-Slack-Signature` (`v0=…`) + `X-Slack-Request-Timestamp` (5-min skew); respond within 3 s; block actions carry `actions[0].action_id` and `value`; Block Kit button `value` ≤ 2000 chars. Discord component interactions: `X-Signature-Ed25519` + `X-Signature-Timestamp`, Ed25519 over `timestamp + rawBody` with the app public key (Node `crypto.verify(null, …)` with an Ed25519 public key built from the hex), PING type 1 → `{ type: 1 }`, message component interaction type 3 → respond type 4 (message) or 7 (update); `custom_id` ≤ 100 chars. Telegram inline keyboard: `reply_markup: { inline_keyboard: [[{ text, callback_data }]] }` (`callback_data` ≤ 64 bytes) → inbound `callback_query` on the existing per-connection webhook; answer with `answerCallbackQuery`.

## File structure

```
nodes/logic/wait.ts            logic.wait: { mode: "duration"|"until", seconds?, until? (ISO) } → control sleep
nodes/logic/approval.ts        logic.approval: { connectionId, channel|chatId, message } → posts buttons, control hook; handles ["approved","rejected"]
nodes/logic/wait-for-webhook.ts logic.waitForWebhook: {} → control hook; outputs { body, headers }
nodes/logic/loop.ts            logic.loop: { items: string (template → array) } — handled specially by runGraph (see Task 4)
workflows/run-graph.ts (mod)   hook token registration, loop expansion
workflows/steps/run-node.ts (mod) write hookToken on waiting steps; $item injection
app/api/events/slack/[connectionId]/route.ts     interactivity (+ url_verification for Phase 5 events)
app/api/events/discord/[connectionId]/route.ts   interactions
app/api/events/telegram/[connectionId]/route.ts (mod) callback_query → resume
app/api/wait/[token]/route.ts  POST body → resumeHook
lib/signatures/{slack,discord}.ts (+ tests)  lib/hooks.ts (token helpers, resumeByToken)
convex/engine.ts (mod)         getStepByHookToken (secret-checked), recordResume
tests/signatures.test.ts  tests/loop.test.ts  tests/approval.test.ts
```

## Tasks

### Task 1: Wait node + hook plumbing
- [ ] `logic.wait` (icon `Clock`): `control` → `{ kind: "sleep", ms }` computed from `seconds` or `until` (clamp ≥ 1000 ms; `until` in the past → 0); outputs `{ waitedMs }`. `runNode` writes `hookToken: `${executionId}:${nodeId}`` and status `waiting` when `control.kind === "hook"`. `convex/engine.ts#getStepByHookToken` + `lib/hooks.ts#resumeByToken(token, payload)` (looks up the step via the engine client, calls `resumeHook`, maps `HookNotFoundError` → 404). Unit tests for the wait math. Commit `feat(control): wait node and hook token plumbing`.

### Task 2: Approval node (Slack, Discord, Telegram buttons) + interactivity routes (+ signature tests)
- [ ] `logic.approval` (icon `ShieldCheck`, `credential: "chat"` = slack | discord-bot | telegram connection): `run` posts the message with two buttons whose `value`/`custom_id`/`callback_data` is `approve:<token>` / `reject:<token>` (token = the hook token; keep under Telegram's 64-byte cap by storing a short random `hookId` on the step and mapping `hookId → token` via `getStepByHookToken`), returns `{ posted: true, provider }` and `control: { kind: "hook" }`; handle from the resumed payload `approved ? "approved" : "rejected"` (the workflow derives the handle from the hook payload — extend `runGraph`: if the resumed output has `handle` use it). Routes: Slack (`lib/signatures/slack.ts#verifySlack(rawBody, ts, sig, signingSecret)`; parse `payload=`; `block_actions` → `resumeByToken(token, { approved, by: user.username, provider: "slack" })`; respond 200 with a replacement message text "✅ Approved by …"), Discord (`lib/signatures/discord.ts#verifyDiscord(rawBody, ts, sig, publicKeyHex)`; type 1 → `{ type: 1 }`; type 3 → resume → respond `{ type: 7, data: { content, components: [] } }`), Telegram (`callback_query` → resume → `answerCallbackQuery` + `editMessageReplyMarkup` to remove buttons). Connection secrets: Slack signing secret stored inside the sealed secret of the Slack connection (`fields`: `botToken`, `signingSecret`), Discord public key in `meta.publicKey` (not secret). Tests: known-vector HMAC for Slack, Ed25519 keypair generated in-test for Discord, 3-second-old timestamp ok / 6-minute-old rejected. Commit `feat(control): approval node with slack/discord/telegram buttons and resume routes`.

### Task 3: Wait-for-webhook node
- [ ] `logic.waitForWebhook` (icon `Webhook`): config panel shows `${APP_ORIGIN}/api/wait/<token>` (token = `${executionId}:${nodeId}` is only known at run time, so show the pattern and expose the concrete URL on the step row / runs page); `app/api/wait/[token]/route.ts` POST → `resumeByToken(token, { body, headers })` → 200 `{ resumed: true }` / 404. Outputs `{ body, headers }`. Commit `feat(control): wait-for-webhook node and resume route`.

### Task 4: Loop (sequential, v1)
- [ ] `logic.loop` (icon `Repeat`): inputs `{ items: z.string() }` (a template resolving to an array; if it resolves to a JSON string, parse), outputs `{ results: z.array(z.any()), count: z.number() }`. `runGraph`: when a node is a loop, evaluate the items via a `resolveItems` step, then for each item run the loop **body** (the subgraph reachable from the loop's `each` handle, stopping at the loop's `done` handle join) sequentially with `item` passed to every `runNode` in the body (`$item` in templates); collect the body's last outputs into `results`; then continue along the `done` handle. Handles: `["each","done"]`. Keep it simple: the body is the linear chain from `each` until a node with no outgoing edges or the first node that also has an incoming edge from the loop's `done` side. Tests in tests/loop.test.ts for the body extraction and the iteration order (pure helpers in workflows/graph.ts). Commit `feat(control): sequential loop with $item`.

  **As built (2026-09-02).** Two corrections to the sketch above. (1) `items` is `z.preprocess(v => typeof v === "string" ? v : JSON.stringify(v), z.string())`, not a bare `z.string()`: `resolveTemplates` hands a whole-template reference back as the *raw* array, which a plain string schema rejects before `run` ever sees it. The JSON Schema is still `{ type: "string" }`, so the config panel keeps a text field with the variable picker. (2) A body node runs once per item, so `steps` gained `iteration: v.optional(v.number())` and `by_execution_node` became `["executionId", "nodeId", "iteration"]` — without it `runNode`'s "already succeeded" guard hands pass 2 the output of pass 1. The items reach the workflow on `NodeResult.items`, filled from a new `expand?(inputs)` hook on `NodeDef` (recomputed, not stored, so a replayed step still knows what it was iterating); `runGraph` runs the body, records the loop's real `{ results, count }` through `recordLoop`, and continues down `done`. Wait and Approval work inside a body (`hookTokenFor` takes the pass), fan-out inside a body does not, and loops do not nest.

### Phase check
Wait 30 s node shows `waiting` and the run resumes with no compute; Approval posts buttons to the user's Slack/Discord/Telegram connection, the run suspends (`waiting`), Approve on a phone resumes down `approved`, Reject down `rejected`; Wait-for-webhook resumes on a curl POST; Loop over `[1,2,3]` runs the chain three times with `{{ $item }}`; `pnpm typecheck && pnpm lint && pnpm test` green.
