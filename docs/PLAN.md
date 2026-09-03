# PapaFlow Build Plan

> Teams bring their own AI keys, connect chat apps, and either draw a workflow on the canvas or describe it in one box and let a Builder agent draw it for them. Every run is durable, every credential is encrypted, and Clerk Billing turns it into a B2B SaaS with plan-gated features. Working title is a placeholder.

_Stack: Next.js · Convex · Clerk Orgs + Billing · Vercel Workflows · eve · AI SDK 7 · React Flow · Researched 2 Sept 2026 against official docs_

_Markdown export of the published plan. Sections map 1:1 to the page; code and tables are verbatim._

## Verdict

- **Runs: One generic `"use workflow"` interprets any graph.** Steps retry, `sleep()` costs nothing, hooks pause a run for a webhook or a Slack "Approve" click. Every run is in the Vercel dashboard trace viewer for free.
- **Two ways to build: Canvas by hand, or a Builder agent on eve (Pro).** The Builder's tools write straight to the Convex workflow doc, so the canvas draws itself live. When it needs a key it parks the turn and pops a secure widget; the secret goes to the vault, never to the model.
- **SaaS layer: Clerk Orgs + Billing, plan state synced to Convex.** Feature slugs gate connectors, the Agent node, schedules and the Builder. Numeric limits (workflows, runs) live in app code keyed by plan slug, enforced in Convex mutations. Ten BYOK AI providers, all API keys.

## How it fits together

- **Next.js + React Flow + Clerk** (App): Canvas, node config panels, connections settings, form pages, OAuth callbacks, webhook routes. Clerk Organizations for workspaces, Clerk Billing for plans.
- **Convex** (State): Workflows, executions, per-node step records, encrypted connections, org plan state, usage counters. The canvas is a `useQuery` subscription, so live status and the Builder drawing nodes cost nothing extra.
- **Vercel Workflows** (Runs): `start(runGraph, [{ graph, trigger }])`. Vercel Queues dispatch each step, run state and event log are managed, replay survives deploys and crashes. Steps write status back to Convex.
- **eve service** (Agents): Two eve agents beside the app: the Runtime agent behind the Agent node, and the Builder agent that turns a prompt into a workflow. Model calls go direct to providers with the org's key.

A run's life: a trigger (form submit, webhook, schedule tick, Run button) lands in a route handler, which checks the org's entitlements, writes an `executions` row in Convex and calls `start()` with a snapshot of the graph. The workflow function walks the graph: for every node it calls one `runNode` step, which resolves templates, decrypts the credential, calls the connector, writes the step record to Convex, and returns the output plus which edge handle fired. Condition and Switch only return a handle; the workflow follows matching edges. Wait nodes call `sleep()`. Approval and Wait-for-webhook nodes call `createHook()` and the run suspends until a route calls `resumeHook(token)`. The canvas is subscribed to the step records, so it lights up as they land.

Ownership is organisational, not personal. Workflows, connections and usage belong to the Clerk organisation (the active org in the session), with `createdBy` on each row. A solo user is just an org of one, which is also how Clerk's default Free org plan works.

## SaaS layer: Clerk Billing for B2B

Clerk Billing runs on Stripe (your own Stripe account in production; a shared test gateway in dev), charges 0.7% on top of Stripe's fees, and models plans as sets of boolean **feature slugs**. Plans are created in the dashboard under "Plans for Organizations"; every org lands on the Free plan automatically. The current session token carries the active org's plan and features, so `has()` works on both client and server without a database call.

| Plan | Feature slugs | Numeric limits (app code) | What that unlocks |
|---|---|---|---|
| Free (`free_org`, Clerk's auto-created default org plan) | `core_connectors` | 3 workflows · 100 runs/month · 1 member · schedules no faster than hourly | Canvas, HTTP, Resend email, Discord webhook, Telegram, one AI connection, Manual/Webhook/Form triggers. |
| Pro — per org, monthly or annual, 7-day trial | `core_connectors` `pro_connectors` `ai_agent` `ai_builder` `schedules` `run_history_30d` | Unlimited workflows · 5,000 runs/month · 5 members | Slack, Notion, Airtable, Linear (the OAuth ones), the Agent node, the Builder agent, minute-level schedules, 30-day run history. |
| Team — per seat | everything in Pro + `shared_connections` `audit_log` `priority_runs` | 50,000 runs/month · seats billed per member | Org-wide shared connections, run audit log, higher concurrency. Seat limits above 20 or unlimited need Clerk's B2B add-on ($100/mo), so cap Pro at 5 and let Team be the per-seat one. |

### Where gating runs

Three layers, because the UI check alone is decoration. In the browser, `<Show when={{ feature: "org:pro_connectors" }} fallback={<UpgradeCard />}>` around Pro node cards in the sidebar, and `<PricingTable for="organization" />` on the billing page. (Clerk Core 3, March 2026, removed `<Protect>`; `<Show>` is the replacement and takes `plan`, `feature`, `permission` or a function of `has`.) In route handlers and server actions, `const { has } = await auth(); if (!has({ feature: "org:ai_builder" })) return 403` before starting a Builder session or a run. In Convex mutations, read the org's synced plan row and enforce the numeric limits: `createWorkflow` counts the org's workflows against `PLAN_LIMITS[plan].workflows`, `startExecution` checks the monthly run counter, and `runNode` refuses a node whose connector requires a feature the org no longer has. That last one matters because a downgraded org would otherwise keep running Pro nodes forever.

### Syncing plan state into Convex

Decision (2026-09-02): Clerk is the source of truth — no billing webhook and no mirror tables. In Convex, `requireOrg()` reads the `pla` (`o:<slug>`) and `fea` (`o:a,o:b`) claims from the session token; unknown or missing → `free_org`. The workflow engine has no session, so `lib/billing.ts#getOrgPlan(orgId)` calls `clerkClient().billing.getOrganizationBillingSubscription(orgId)` from `@clerk/backend` (public beta; cached 60 s per process) at run start and snapshots the plan slug on the execution row; `runNode` gates on that snapshot.

Features are booleans only. Clerk has no quantity or metering on features, so numeric limits are a `PLAN_LIMITS` map in code keyed by plan slug, and usage (runs this month, workflow count) is counted in Convex. That's also what powers the usage bar in settings.

> **Pin versions.** The billing methods and types in `@clerk/backend` are still tagged public beta, and `useSubscription` lives under `@clerk/nextjs/experimental`. Clerk markets Billing, trials and per-seat plans as live. Treat it as production-usable, pin `@clerk/nextjs` and `@clerk/backend`, and read the changelog before the shoot.

## The Builder agent

One text box: "When someone fills in my contact form, qualify them with Claude, ask me on Slack if they're hot, then email them and log everything to Notion." The Builder agent works the problem with tools, and because every tool writes to the Convex `workflows` document, the canvas draws itself node by node while the agent narrates. It's the same canvas the user edits by hand, so they can fix anything afterwards. Pro only, via the `ai_builder` feature.

### Its tools

- **get_workflow** `v1`: The graph as it stands — every node's key, type, label, position, stored inputs (templates unresolved) and output handles, every edge as `from → handle → to`, plus `endNodes` and `orphanNodes`. Called before any edit, and the reason the agent never asks "which nodes are the end nodes?".
- **list_node_types** `v1`: Returns the node catalogue with input schemas as JSON Schema, filtered by what the org's plan allows. The model can't reach for a Pro node on a Free org.
- **list_connections** `v1`: The org's active connections: id, provider, label, status. Never secrets.
- **list_picker_options** `v1`: The same lists the canvas dropdowns get (`pickConnectionOptions`, re-implemented eve-side in `agents/builder/lib/pickers.ts` because `lib/connections-server.ts` reaches `lib/engine-client.ts`): Airtable bases/tables/columns, Slack channels, Telegram chats, Notion databases/properties, a provider's models. The credential is opened inside the tool and dropped; ids and labels come back. This is what stops the agent inventing a column name.
- **add_node · connect_nodes · configure_node · update_node · remove_node** `v1`: Convex mutations on the workflow doc. Inputs validated against the node's zod schema, so a bad config comes back as a tool error the agent can fix. `update_node` is label and position only — position is React Flow's, not any node's schema.
- **set_trigger_sample · rename_workflow** `v1`: The Manual trigger's sample JSON (so `{{ trigger.… }}` resolves to something the first time Run is pressed) and the workflow's name.
- **request_connection** `v1`: The pause. Declares what it needs (`{ provider: "slack" }` or `{ provider: "anthropic", kind: "apiKey" }`); the turn parks, the UI shows the widget, the tool resumes with `{ connectionId, label }`.
- **validate_workflow** `v1`: Dangling edges, unconfigured required inputs, template references to nodes that don't exist, Condition without both branches. Returns a fix list.
- **run_workflow · list_runs · get_run** `v2` (the plan's old `test_run`, split in three): `run_workflow` starts a manual run with an optional payload and waits for it; `list_runs` is one line per recent run; `get_run` is a run's step rows in order with status, duration, error, the unresolved-template `warnings`, and input/output trimmed to ~2 KB each. Loop passes are numbered and an Agent node's tool calls are labelled with their parent. **The run is started through `POST /api/engine/run` in the Next app, not `start()` here** — a workflow function only exists after the Workflow SDK's compiler has transformed it, and that happens in the Next build, not in the agent's own Vercel service (Phase 12 addendum item 5 in `docs/research/eve-spike.md`). The route authenticates with `ENGINE_SECRET` as a bearer token compared with `timingSafeEqual`, and calls the same `startRun` the Run button's server action calls.
- **ask_user** `v1`: eve's own `ask_question`, left enabled — a plain clarifying question when the prompt is ambiguous ("which Slack channel?").
- **finish** `v2`: Publishes the workflow, returns a summary and how it starts (never the webhook URL — it carries `webhookSecret`). **Publishing goes through `POST /api/engine/publish` in the Next app, not a Convex mutation** — a Schedule trigger's "on" is the workflow's `status` *and* a durable Convex job armed for the next occurrence, and deciding whether the interval is even allowed needs the plan (a Clerk concern the Next app, not Convex, can resolve), so while `finish` wrote the status through `api.builder.activate` a schedule-triggered workflow it finished was live in the canvas and never scheduled. The route authenticates the same way `/api/engine/run` does (`ENGINE_SECRET` as a bearer token compared with `timingSafeEqual`) and calls the same `applyPublish()` (`lib/publish-server.ts`) the Publish button's server action calls, with the plan read from Clerk's Backend API. A plan that refuses the interval answers 400 `too_frequent` and leaves the workflow *unpublished*, so the model can slow the schedule down with `configure_node` and call `finish` again.

### The credential handoff

The rule: the secret never touches the model, the eve process, or a tool argument. `request_connection` is a durable eve tool, meaning its `execute` starts with `"use workflow"` and can `await ask(ctx, { prompt, display: "confirmation", allowFreeform: true })` (synchronous call returning a thenable Hook; race it with `sleep("24h")` for a deadline), which parks the turn with nothing running. eve publishes an `input.requested` event on the session; the app's chat panel, subscribed through `useEveAgent`, sees that the pending ask came from `request_connection` and renders its own widget instead of the default question card: an API-key form for AI providers (with the "test connection" call before save), a "Connect Slack" button that opens the OAuth flow in a popup, a paste box for a Discord webhook URL. The widget submits to the app's own route, which seals the secret into Convex, and then the client answers the ask with the new `connectionId` as the text. The tool wakes up, reads that id, confirms in Convex that it belongs to this org, and returns `{ connectionId, label }` to the model. From the agent's point of view it asked for a Slack connection and got an id back. Cancel answers with `optionId: "cancel"` and the agent either asks again or finishes with a note.

Approval works the same way for destructive tools: `remove_node` gets `approval: always()` so the agent can't delete half a workflow without a click.

### How it maps onto eve

Second directory, `agents/builder/`, with its own `instructions.md` (how to design a good workflow: one trigger, templates over hardcoding, prefer Extract + Switch over long prompts, always validate before finishing) and a `skills/` folder with one markdown file per connector describing what its node is good for. Tools are static files under `agents/builder/tools/`, which they have to be for durable tools anyway. Gating happens twice: the route that opens a Builder session checks `has({ feature: "org:ai_builder" })`, and every tool's `execute` reads the org from `ctx.session.auth` and checks its plan row in Convex before doing anything (defence in depth, and it also filters `list_node_types` to what the plan allows). `defineDynamic` supplies the per-org instructions; the model comes from a `step.started` handler that builds an AI SDK model from the org's decrypted key (session/turn handlers may only return model-ID strings), falling back to a Gateway model-ID string on your key with a per-org cap, which is itself a reason to upgrade. Sessions are durable and multi-turn, so "actually, make it post to Discord instead" is just the next message in the same session.

### Manual and agent, same document

Both paths mutate the same Convex `workflows` row through the same validated mutations. The Builder's mutations carry `source: "builder"` and the session id, so the canvas can highlight nodes the agent just placed and the history panel can show "Builder added Classify". If the user drags something while the agent is mid-turn, the agent's next `configure_node` sees the current state, because tools read from Convex, not from a snapshot.

- *The plan* · **eve Builder agent** — _Durable tools, ask(), approvals, streaming_. Everything the Builder needs is a first-class eve concept. Pausing for a credential without eve means hand-rolling a hook and a resume route around a `ToolLoopAgent`.
- *Fallback* · **ToolLoopAgent + Workflow SDK hook** — _More code, same behaviour_. Run the tool loop inside a `"use workflow"` with `WorkflowAgent`, and have `request_connection` return a hook token the UI resumes. Workable, and it's what you'd show if eve's API moves under you.
- *Keep separate* · **Two agents, not one** — _Builder vs Runtime_. The Builder edits workflows and has no connector tools. The Runtime agent (behind the Agent node) runs inside workflows and has connector tools but can't edit the graph. Different instructions, different blast radius, same framework.

## AI connectors

All API keys, which makes them the simplest credential type in the vault. The model picker is populated from each provider's list endpoint on connect, so model names never go stale in the UI; the ones below are what those endpoints return today and will have moved by the time the video is out.

| Provider | Key looks like | Auth header | Test connection | AI SDK 7 | Models today | Does |
|---|---|---|---|---|---|---|
| OpenAI | `sk-proj-…` | `Authorization: Bearer` | `GET /v1/models` | `@ai-sdk/openai` · `createOpenAI({ apiKey })`, Responses API by default | GPT-5.6 family, `gpt-image-2`, `gpt-4o-mini-tts`, `gpt-4o-transcribe` | Text, tools, structured output, vision, images, TTS, STT |
| Anthropic | `sk-ant-api03-…` | `x-api-key` + `anthropic-version: 2023-06-01` | `GET /v1/models` | `@ai-sdk/anthropic` · `createAnthropic({ apiKey })` | `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-…` | Text, tools, structured output, vision, PDFs, thinking |
| Google Gemini | `AIza…` | `x-goog-api-key` | `GET /v1beta/models` | `@ai-sdk/google` · factory is `createGoogle` (`createGoogleGenerativeAI` is a deprecated alias) | `gemini-3.7-flash`, `gemini-3.1-pro-preview`, `gemini-3.1-flash-image-preview` | Text, tools, vision, native image gen, native TTS |
| xAI | `xai-…` | `Authorization: Bearer` | `GET /v1/api-key` | `@ai-sdk/xai` · `createXai({ apiKey })` | `grok-4.6`, `grok-imagine-image` | Text, tools, images |
| Mistral | no fixed prefix | `Authorization: Bearer` | `GET /v1/models` | `@ai-sdk/mistral` | `mistral-large-latest`, `mistral-small-latest`, Voxtral TTS/STT | Text, tools, vision, TTS, STT |
| Groq | `gsk_…` | `Authorization: Bearer` | `GET /openai/v1/models` | `@ai-sdk/groq` | `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `whisper-large-v3` | Fast open models, STT. Good "watch how fast" moment |
| DeepSeek | `sk-…` | `Authorization: Bearer` | `GET /models` | `@ai-sdk/deepseek` | `deepseek-v4-flash`, `deepseek-v4-pro` (old `deepseek-chat` alias retired July 2026) | Cheap text |
| OpenRouter | `sk-or-v1-…` | `Authorization: Bearer` | `GET /api/v1/key` returns limits and usage | `@openrouter/ai-sdk-provider` (community, confirm the v7 peer dep) | Everything, one key | The "I don't want ten keys" option |
| ElevenLabs | no prefix | `xi-api-key` | `GET /v1/user` | `@ai-sdk/elevenlabs` · `generateSpeech` | `eleven_v3`, `eleven_flash_v2_5`, `scribe_v2` STT | TTS, STT |
| fal.ai | no prefix | `Authorization: Key` | cheap `flux/schnell` call | `@ai-sdk/fal` · `generateImage` | `fal-ai/flux/dev`, `fal-ai/recraft/v3/text-to-image`, Wizper STT | Images, STT |

Replicate (`r8_…`, `GET /v1/account`) and Deepgram (`Authorization: Token`, `nova-3`) also have official packages if you want them in the sidebar. Cohere too.

### Two ways to wire a user's key

- *Pick for v1* · **Direct provider packages** — _createX({ apiKey: userKey }) per call_. Provider instances are plain objects, so build one per step from the decrypted key. One `LLM` node with a provider dropdown maps to a switch over factories. The user's key goes to the provider and nowhere else, which is the honest thing to say on camera about a BYOK product.
- *All-Vercel option* · **AI Gateway with per-request BYOK** — _providerOptions.gateway.byok_. One gateway key, one model catalogue, model strings like `"anthropic/claude-opus-5"`, and `byok: { anthropic: [{ apiKey }] }` on each call. Zero token markup. The catch: the docs say a failing user key falls back to your credits, and BYOK isn't capped by budgets. Validate keys on connect and check the response's provider metadata before you trust it in a multi-tenant app.
- *Node code* · **What the LLM step does** — _~20 lines_. `const model = providerFor(conn.provider, key)(inputs.model)`, then `generateText({ model, prompt, output: Output.object({ schema }) })` for Extract, `Output.choice` for Classify, plain text for LLM. `generateObject` is deprecated; don't use it on camera.

## Chat and app connectors

Ranked by how good the payoff looks on screen. Discord gets two entries because the webhook version is a one-paste connect and the bot version unlocks channel pickers and slash-command triggers.

| Connector · action | Auth | What we store per user | Endpoint | Trigger | Notes |
|---|---|---|---|---|---|
| Slack — Post to a channel | `OAuth` | Bot token `xoxb-…`, `team_id`, `bot_user_id`, granted scopes | `POST slack.com/api/chat.postMessage` | `push` | Scopes `chat:write`, `chat:write.public`, `channels:read`. Token doesn't expire unless you switch on rotation, which can't be switched off. Events API triggers need a 3s ack. Block Kit buttons make the Approval node. |
| Discord webhook — Post message or embed | `Webhook URL` | Webhook `id` + `token` per channel | `POST discord.com/api/webhooks/{id}/{token}` | `no` | Easiest connector in the app. Embeds up to 10, 6,000 chars total. Never retry a 404, the webhook is gone. |
| Discord bot — Post as the bot, channel picker, slash commands | `Bot token` | App-level bot token in env; per user: `guild_id` the bot was invited to | `POST /channels/{id}/messages` with `Authorization: Bot` | `push` | User clicks an invite URL with `scope=bot applications.commands&permissions=3072`. Pickers via `GET /users/@me/guilds` then `/guilds/{id}/channels`. Slash commands arrive at an Interactions URL, Ed25519-signed, 3s to reply with a deferred type 5. |
| Telegram — Send message | `Bot token` | Token from BotFather, discovered `chat_id`s | `POST api.telegram.org/bot{token}/sendMessage` | `push` | Simplest chat API there is. `getMe` to validate, `setWebhook` with a `secret_token` for inbound. Chat id comes from the first inbound message. |
| Microsoft Teams — Post to a channel | `Workflow URL` | Power Automate URL with its `sig` | `POST` Adaptive Card JSON | `no` | Office 365 connectors were shut down May 2026. User creates a "post to channel when a webhook is received" flow and pastes the URL. Send an Adaptive Card (Message Card format is also accepted, without buttons); ≤28 KB, ~4 req/s. |
| WhatsApp — Send message via Twilio sandbox | `API key` | `accountSid`, API key SID + secret | `POST …/Messages.json` with `From=whatsapp:+14155238886` | `push` | Demo-able in minutes: text "join <code>" to the sandbox number. 24h reply window, sessions expire after 3 days. Meta Cloud API is the production route and needs business verification. |
| Email (Resend) — Send from the app's domain | `App key` | Nothing per user | `POST api.resend.com/emails` | `push` | Works before anyone connects anything. Inbound email via MX record fires `email.received` for a trigger. Requests without a `User-Agent` header get 403. |
| Notion — Create page in a database | `OAuth` | `access_token`, `refresh_token`, `workspace_id`, chosen `data_source_id` | `POST api.notion.com/v1/pages`, header `Notion-Version: 2026-03-11` | `push` | Databases split into "data sources" in 2025, target the data source id. Webhook subscriptions are created in Notion's UI only, one endpoint for the app, payloads carry IDs only. |
| Airtable — Create record, list records | `OAuth` `PAT` | `access_token` (60 min), `refresh_token` (60 days, rotates), `baseId`, `tableId` | `POST api.airtable.com/v0/{base}/{table}` | `push` | PKCE mandatory. Webhooks ping, you pull payloads with a cursor; they expire after 7 days unless refreshed. 5 req/s per base. |
| Linear — Create issue | `API key` `OAuth` | API key (no documented prefix — do not validate on it) and chosen `teamId`; OAuth tokens expire after 24h with rotating refresh tokens (since 2026-04-01); rate limit is HTTP 400 + `RATELIMITED`, not 429 | `POST api.linear.app/graphql` `issueCreate`, header is the bare key, no Bearer | `push` | Validate with `{ viewer { id } }`. Webhooks need a workspace admin or an OAuth app with `admin` scope, so the trigger is v2. |
| GitHub — Create issue, comment on PR | `Fine-grained PAT` | PAT + `owner/repo` | `POST /repos/{o}/{r}/issues` | `push` | GitHub App is the grown-up path (8h user tokens). 80 content-creating requests per minute. |
| Stripe — Trigger on payment events | `Signing secret` | Per-endpoint `whsec_…` | Inbound only | `push` | User pastes our unique URL into their Stripe. HMAC over `t.rawBody`, 5-min tolerance, dedupe on `event.id`. |

## Triggers

Every trigger ends in the same place: a route handler that writes an execution row and calls `start(runGraph, …)`. What differs is who calls the route and how you prove it was them. Signed triggers read the raw body with `await req.text()`, verify, then parse. Return 200 immediately; the run happens on the queue.

| Trigger | Route | Verification | Payload becomes | Notes |
|---|---|---|---|---|
| Manual | Run button → server action | Clerk session | Optional sample JSON | The first thing that works. |
| Webhook | `/api/hooks/{workflowId}/{secret}` | Unguessable secret in the path | Body, headers, query | Generic inbound. Curl it on camera. |
| Form | Public page `/f/{workflowId}` | None needed, add Turnstile later | Field values | Makes the demo self-contained. |
| Schedule | Convex alarm clock → `/api/engine/schedule-tick`, see below | `ENGINE_SECRET` bearer | `{ firedAt, scheduleId }` | No cron infrastructure at all. |
| Slack mention | `/api/events/slack` | HMAC-SHA256 of `v0:{ts}:{body}` with signing secret; echo `url_verification` challenge once | Event object | Ack within 3 seconds or Slack retries. |
| Discord slash command | `/api/events/discord` | Ed25519 over timestamp + body with the app public key; answer PING with type 1 | Command name, options, user, channel | Reply type 5 (deferred) inside 3s, then PATCH the original message when the run finishes. |
| Telegram message | `/api/events/telegram/{connectionId}` | `X-Telegram-Bot-Api-Secret-Token` header equals the stored secret | Update object | Set with `setWebhook` when the connection is created. |
| Stripe event | `/api/events/stripe/{connectionId}` | `Stripe-Signature` HMAC, per-connection `whsec_` | Event | Stripe retries for 3 days, dedupe on `event.id`. |
| GitHub event | `/api/events/github/{connectionId}` | `X-Hub-Signature-256`, constant-time compare | `issues` / `pull_request` payload | Repo webhook created via API with a generated secret. |
| Airtable change | `/api/events/airtable/{webhookId}` | `X-Airtable-Content-MAC` with `macSecretBase64` | Pulled payloads | Ping is empty, fetch `/webhooks/{id}/payloads?cursor=`. Refresh every 5 days. |
| Email received | `/api/events/resend` | Svix headers, `whsec_` | Fetched email body | Replaces the Gmail trigger without any Google verification. |

### Schedules without cron

Vercel Cron Jobs are static in `vercel.json`, which is useless for per-user schedules. The first cut of this used the Workflow SDK's `sleep()`, which has no maximum and costs nothing while sleeping — a schedule as a workflow that loops: compute the next fire time in a step, `sleep(untilThatDate)`, `start(runGraph)` from a step, repeat. It worked, but it meant one *Active* Workflow SDK run per published schedule forever, roughly eight recorded events per tick, and continue-as-new bookkeeping (the 25,000-event cap forces a fresh copy of the run every few hundred iterations, and pausing has to cancel whichever copy is currently sleeping).

**Convex is the alarm clock instead** (decision 2026-09-03): a published schedule is a row in `schedules` plus one durable Convex scheduled job (`ctx.scheduler.runAt`) armed for the next occurrence — no sleeping process anywhere. When the job wakes, `convex/schedules.ts#fire` POSTs `/api/engine/schedule-tick` with `ENGINE_SECRET`; that route re-reads the schedule and the workflow, decides whether the tick may start a run, calls `startRun` exactly like every other trigger, and hands back the next occurrence for `fire` to arm in turn.

```ts
// convex/schedules.ts (internal action, scheduled by ctx.scheduler.runAt/runAfter)
export const fire = internalAction({
  args: { scheduleId: v.id("schedules"), plannedAt: v.number(), attempt: v.number() },
  handler: async (ctx, { scheduleId, plannedAt, attempt }) => {
    const schedule = await ctx.runQuery(internal.schedules.byId, { scheduleId });
    if (!schedule || !schedule.enabled) return null;

    if (attempt === 0) {
      // Exactly-once: plannedAt is the instant this tick was *due*, so a duplicate delivery of the
      // same tick — a retry, a double-fire — is refused rather than starting a second run.
      const claimed = await ctx.runMutation(internal.schedules.claimTick, { scheduleId, plannedAt });
      if (!claimed) return null;
    }

    const response = await fetch(`${process.env.APP_ORIGIN}/api/engine/schedule-tick`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ENGINE_SECRET}` },
      body: JSON.stringify({ scheduleId, workflowId: schedule.workflowId, orgId: schedule.orgId, plannedAt }),
    });
    // 200 → record the tick and arm `nextAt`; 4xx → disarm (unpublished); 5xx/unreachable → retry
    // up to three times a minute apart, then arm a fallback fifteen minutes out.
  },
});
```

Pausing is `disarm`: cancel the pending job, disable the row. Editing the cron re-arms: `arm` cancels whatever was pending before it schedules the replacement, so at most one job per schedule exists at a time. `ctx.scheduler.cancel()` throws if the job it names has already completed, so every cancel site checks `ctx.db.system.get(jobId).state.kind === "pending"` first — verified against `node_modules/convex@1.45.0`'s `server/scheduler.d.ts`, which documents the throw; the public docs page is silent on it. An hourly schedule now costs 24 Convex function calls and 24 HTTP requests a day, and a Vercel Workflow run is spent only when a tick actually starts one.

## OAuth

Only Slack, Notion and Airtable (and Linear if you go past API keys) need it now, and they all use the same authorization-code dance. Build it once as a generic module; each provider is a config object.

1. **User clicks "Connect Slack"** — Route creates a random `state` (plus a PKCE verifier for Airtable), stores both against the Clerk user with a 10-minute expiry, redirects to the authorize URL with scopes.
2. **Provider redirects to `/api/oauth/{provider}/callback`** — Look up `state`, reject if missing or old. That's the CSRF check that matters.
3. **Exchange the code** — `POST` the token URL with code, redirect URI and client credentials (Basic auth for Notion and Airtable; PKCE verifier for Airtable). Slack's response has the bot token in `access_token` plus `team` and `bot_user_id`.
4. **Encrypt and store** — Seal the token blob, write a `connections` row with `expiresAt`, granted scopes and a display label ("PAPAFAM workspace"). Return only the label to the browser.
5. **Before every node run, get a fresh token** — If `expiresAt − 60s` has passed, refresh; if the provider rotated the refresh token (Airtable, Notion) overwrite the pair. On `invalid_grant`, mark the connection "needs reconnect" and fail the step with that message. Notion returns no `expires_in` (store `expiresAt: null`, refresh on 401; `refresh_token` may be null → needs reconnect).

```ts
// lib/oauth/providers.ts
export const PROVIDERS = {
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "chat:write.public", "channels:read"],
    scopeParam: "scope",               // bot scopes; user scopes go in user_scope
    pickFromResponse: ["team.id", "team.name", "bot_user_id"],
    expires: false,                    // unless token rotation is enabled in the app settings
  },
  notion: {
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    extraAuthParams: { owner: "user" },
    clientAuth: "basic", refreshRotates: true,
    pickFromResponse: ["workspace_id", "workspace_name", "bot_id"],
  },
  airtable: {
    authUrl: "https://airtable.com/oauth2/v1/authorize",
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    scopes: ["data.records:read", "data.records:write", "schema.bases:read", "webhook:manage"],
    pkce: true, clientAuth: "basic", refreshRotates: true,   // access token 60 min, refresh 60 days
  },
} satisfies Record<string, ProviderConfig>;
```

- *Pick for the video* · **Build the generic module** — _~150 lines + 15 per provider_. Watching the callback land and a token get encrypted is the "oh, that's how it works" chapter. Slack is the on-camera one; Notion and Airtable are "same module, new config".
- *Shortcut* · **Clerk as the vault** — _0 lines of OAuth_. `clerkClient.users.getUserOauthAccessToken(userId, "notion")` with custom scopes on the connection. Refreshes lazily on that call. Slack via Clerk is Sign-in-with-Slack (a user token), not a bot install, so it doesn't cover the posting case.
- *Production upgrade* · **Nango** — _Free to 10 connections, then $0.29/connection/mo_. Open source, 900+ providers, hosts the consent screen, refreshes tokens, returns a live token from `nango.getConnection()`. eve's own `@vercel/connect` does the same job for tools inside an eve agent.

## Credential vault

One `connections` table in Convex, secrets encrypted with AES-256-GCM before they're written, decrypted only inside a `"use step"` that's about to call a provider. Encryption happens in Node (the OAuth callback, the credential-save route, the workflow steps), so Convex only ever stores ciphertext and its own functions never hold a key. Same shape n8n uses (they moved from AES-CBC to GCM with key rotation this year).

### Schema

| Field | Meaning |
|---|---|
| `orgId` | Clerk organisation id. Connections belong to the workspace. Indexed. |
| `createdBy` | Clerk user id of whoever connected it. |
| `provider` | `"openai" | "anthropic" | … | "slack" | "discord" | "telegram" | "notion" | "airtable" | "linear" | "stripe"` |
| `kind` | `"apiKey" | "oauth2" | "webhookUrl" | "botToken"`, decides the refresh path and the "test connection" call |
| `label` | What the user sees: "OpenAI (personal)", "#leads in PAPAFAM", "@papaflow_bot". Never a secret. |
| `secret` | `{ v: 1, keyId, iv, tag, ct }` base64. The whole token blob encrypted as one JSON string. |
| `hint` | Last four characters, for the masked list: `••••4f2a` |
| `expiresAt` | Unix ms, null for non-expiring. Read without decrypting to decide whether to refresh. |
| `scopes` | Granted, not requested. Slack users can now decline individual scopes. |
| `meta` | Non-secret extras: Slack `team_id`, Notion `workspace_id`, Airtable `baseId`, Telegram `chat_ids`, Discord `guild_id`, the model list fetched at connect time. |
| `status` | `"active" | "needs_reconnect" | "revoked"` |
| `requiresFeature` | `null | "pro_connectors"`, denormalised from the connector definition so `runNode` can gate without loading the catalogue. |

### Encryption

Steps run in full Node, so this is Node's `crypto`. The key is 32 random bytes, base64, in the `CREDENTIALS_KEK` env var (separate values per environment). AAD binds the ciphertext to its row so a blob copied between users refuses to decrypt.

```ts
// lib/vault.ts   (server only, called from "use step" functions and OAuth callbacks)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const KEY_ID = "k1";
const kek = () => Buffer.from(process.env.CREDENTIALS_KEK!, "base64");   // 32 bytes

export function seal(plaintext: object, aad: string) {
  const iv = randomBytes(12);                                             // fresh per row
  const c = createCipheriv("aes-256-gcm", kek(), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(plaintext), "utf8"), c.final()]);
  return { v: 1, keyId: KEY_ID, iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) };
}

export function open(s: Sealed, aad: string) {
  const d = createDecipheriv("aes-256-gcm", kek(), unb64(s.iv));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(unb64(s.tag));
  return JSON.parse(Buffer.concat([d.update(unb64(s.ct)), d.final()]).toString("utf8"));
}
// aad = `${orgId}:${connectionId}`   (ownership is organisational; CLAUDE.md rule 2) wrong row = GCM tag check fails = throws
```

Rules that keep it honest on camera and in production: plaintext never leaves a step or the OAuth callback; the Convex query the client subscribes to returns `label`, `hint`, `status`, `scopes`, never `secret` (project the fields explicitly, don't return the document); the Builder agent's `list_connections` tool uses that same projection; never pass a decrypted key as a step argument or return value, because Workflow SDK records step inputs and outputs in the run log and shows them in the dashboard (pass `connectionId`, decrypt inside); `keyId` lets you add `k2` later and lazily re-encrypt on write. Production upgrade is envelope encryption with a KMS-wrapped data key per row.

### Refresh policy

Proactive first, reactive second. `getFreshToken(connectionId)` checks `expiresAt − 60s`, refreshes and re-seals if stale. If the provider still answers 401, refresh once more and retry once. n8n only does the reactive half and it's their most common credential complaint.

## Runs on Vercel Workflows

The whole engine is one `"use workflow"` function that interprets the graph, and one `"use step"` function that runs a node. Determinism is satisfied because every decision depends only on the graph passed in and on prior step results, both of which are in the event log. Graph edits after a run starts can't affect it; the graph is captured in `run_created`.

```ts
// workflows/run-graph.ts
import { sleep, createHook } from "workflow";
import { runNode } from "@/workflows/steps/run-node";

export async function runGraph({ executionId, graph, trigger }: RunInput) {
  "use workflow";
  const outputs: Record<string, unknown> = { [graph.triggerId]: trigger };
  let frontier = nextNodes(graph, graph.triggerId, null);

  while (frontier.length) {
    const results = await Promise.all(                       // parallel branches fan out
      frontier.map((id) => runNode({ executionId, node: graph.nodes[id], outputs }))
    );
    frontier = [];
    for (const r of results) {
      let output = r.output;
      if (r.control?.kind === "sleep") await sleep(r.control.ms);
      if (r.control?.kind === "hook") {                       // Approval, Wait for webhook
        using hook = createHook<HookPayload>({ token: `${executionId}:${r.nodeId}` });
        output = await hook;                                  // run suspends here, no compute
        await recordResume({ executionId, nodeId: r.nodeId, output });
      }
      outputs[r.nodeId] = output;
      frontier.push(...nextNodes(graph, r.nodeId, r.handle)); // handle = "true" | "false" | case | null
    }
  }
  return { executionId, status: "completed" };
}
```

```ts
// workflows/steps/run-node.ts
import { FatalError, RetryableError } from "workflow";

export async function runNode({ executionId, node, outputs }: NodeInput) {
  "use step";
  const def = NODES[node.type];
  await steps.mark(executionId, node.id, "running");
  try {
    const inputs = def.inputs.parse(resolveTemplates(node.data.inputs, outputs));
    const credential = node.data.connectionId
      ? await vault.openFresh(node.data.connectionId)   // decrypt + refresh inside the step, never as an arg
      : undefined;
    const output = def.outputs.parse(await def.run({ inputs, credential }));
    await steps.mark(executionId, node.id, "success", { input: redact(inputs), output });
    return { nodeId: node.id, output, handle: def.handle?.(output) ?? null, control: def.control?.(output) };
  } catch (e) {
    await steps.mark(executionId, node.id, "failed", { error: message(e) });
    if (e instanceof ConnectorError && e.status === 429) throw new RetryableError(e.message, { retryAfter: e.retryAfter ?? "30s" });
    if (e instanceof ConnectorError && e.status < 500) throw new FatalError(e.message);   // bad input, don't retry
    throw e;                                                                              // default: 3 retries
  }
}
```

**Live canvas.** `steps.mark()` is a Convex mutation called from the step with `ConvexHttpClient`; the canvas has `useQuery(api.steps.byExecution, { executionId })` and re-renders as rows land. Steps run on Vercel with no user session, so they can't present a Clerk token to Convex. Convex's documented answer for servers you control is a public mutation that checks a shared secret argument against `process.env.ENGINE_SECRET` and then calls the internal mutation; internal functions can't be called from outside at all. Set the secret with `npx convex env set` and in Vercel. (The Workflow SDK's own `getWritable()` streams also work, but with Convex in the stack the subscription is the shorter path.)

**Retries.** Steps retry three times by default. Throw `FatalError` for 4xx (the user's input is wrong, retrying won't help) and `RetryableError` with `retryAfter` for 429s so a rate-limited Slack post waits instead of burning attempts. Non-idempotent side effects (sending a message) should carry an idempotency key where the API supports one (Resend does) and otherwise be guarded by the step record: if the step is already "success" when the step re-runs after a crash, return the stored output.

**Limits.** 10,000 steps and 25,000 events per run, 240 seconds max replay, 50 MB payload, no maximum duration. A Loop over 3,000 Airtable rows should run as a child workflow per chunk via `start()` (step-backed in v5; direct or from a step), then wait on a hook rather than awaiting `returnValue` (which polls every second and holds a worker slot). Step names are compile-time (`step//./workflows/steps/run-node//runNode` — confirm with `npx workflow inspect run <id>`), so every node shows as `runNode` in the trace viewer; put `nodeId` and `nodeType` first in the step args so the trace is readable.

**Approval in Slack.** The Approval node's step posts a Block Kit message with Approve and Reject buttons whose `value` is the hook token, returns `control: { kind: "hook" }`, and the run sleeps. Slack's interactivity endpoint verifies the signature and calls `resumeHook(token, { approved, by })`. This is Vercel's own documented pattern and the single best on-camera moment: a workflow frozen mid-canvas, a button pressed on a phone, the canvas continues.

**Setup.** `pnpm add workflow@5.0.0-beta.47` (plain `npm i workflow` installs 4.x; 5.x for multi-region and `@ai-sdk/workflow`; docs at workflow-sdk.dev/v5/docs), `next.config.mts` with `withEve(withWorkflow(nextConfig), { agents })` (eve/next is ESM-only; order is undocumented — spike it), and one `proxy.ts` matcher: `/((?!_next|\\.well-known/workflow/|eve/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)` plus `/(api|trpc)(.*)` and `/__clerk/(.*)`. Local dev uses the Local World in `.workflow-data/` with `npx workflow web` as a run inspector. On Vercel, Fluid compute on, build command `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` with a production deploy key and a separate preview key so every PR gets its own Convex deployment. Hobby includes 50k workflow events a month, which is plenty for the shoot. `next.config.mts` wraps as `withEve(withWorkflow(nextConfig), { agents })` (spiked 2026-09-03: both wrapper orders work in `next dev` and `next build`, and `.mts` is not strictly required — keep `.mts` and this order anyway; keep `agentRules: false` or `next dev` appends an agent-rules block to `CLAUDE.md`).

**Convex and Clerk.** Activate the Convex integration in the Clerk dashboard so the session token itself carries `aud: "convex"`; `ConvexProviderWithClerk` then sends that token and re-authenticates when the active org changes, which re-runs every subscribed query for the new workspace. In Convex functions, `ctx.auth.getUserIdentity()` exposes the token's claims, including the org object and the plan and feature claims; custom `org_id: {{org.id}}` and `org_role: {{org.role}}` session claims were added with `clerk config patch` (validation passed on 2026-09-02; whether the shortcodes resolve is confirmed at first sign-in), and Convex's `requireOrg()` reads them defensively (`org_id` only when it starts with `org_`, else the default `o` claim as an object, dotted key or JSON string) and logs the identity once in dev. Plan and features come from the default `pla`/`fea` claims.

## The Agent node and eve

eve is Vercel's open-source agent framework (Apache-2.0, launched June 2026, still labelled beta). Two things about it shape the plan. First, it isn't a library you call from a route: an agent is a directory (`agents/<name>/instructions.md`, `agent.ts`, `tools/*.ts`, `skills/`, `connections/`, `channels/eve.ts`) that compiles to its own service, deployed beside the Next.js app via `withEve(nextConfig)` and reached over HTTP at `/eve/agents/<name>/eve/v1/*` (named agents via `withEve(cfg, { agents })`); in dev `next dev` spawns the eve server itself. Second, every eve turn already runs as a durable Workflow SDK run, so the Agent node gets retries and replay without doing anything.

### How the node plugs in

The Agent node's step uses `eve/client` with a bearer the step mints itself: a 5-minute HS256 JWT signed with `ENGINE_SECRET` carrying `orgId`, `plan` and `executionId`. The agent's `channels/eve.ts` verifies it with eve's shipped `jwtHmac()` authenticator, which projects those claims straight into `ctx.session.auth.current.attributes` (`principalType: "service"`). A separate Clerk `AuthFn` in the same auth walk handles browser callers as `principalType: "user"`. No Clerk token is minted server-side, and a user's session token never leaves the browser. `client.sessions.create({ message, outputSchema })` → `await response.result()` returns `{ status, data, message, events, inputRequests, sessionId }`; `events` feeds the tool-call sub-rows and a non-empty `inputRequests` means the agent parked on a question, which the node reports as a failure rather than hanging.

Tool approval is built in (`approval: always()`), MCP connections are one `defineMcpClientConnection`, and `@vercel/connect` handles third-party OAuth for tools if you'd rather not route those through your own vault. Skills as markdown files in `agent/skills` are a nice on-camera moment: drop a "how to write a lead follow-up" skill in a folder, the agent picks it up.

- *The plan* · **eve for the Agent node** — _Separate service, Node 24, AI SDK 7_. Right fit for the story: durable agent, per-user tools, approvals, MCP. Pin `eve@0.49.0` (never `eve@beta`, a dead 0.6.0 line); it moved from 0.47 to 0.49 in the two days before this was written, and the launch blog's `needsApproval` is already `approval: always()` in the docs.
- *Fallback A* · **ToolLoopAgent in a step** — _~30 lines, no extra service_. `new ToolLoopAgent({ model, instructions, tools, stopWhen: isStepCount(10) })` from `ai`, run inside `runNode`. Not durable across a crash mid-loop, but the step retries as a whole. Same tool definitions.
- *Fallback B* · **WorkflowAgent inside the workflow** — _@ai-sdk/workflow, needs workflow 5 beta_. Durable per model call, tools with `"use step"` executes, tool approval (docs show `needsApproval` on the tool; AI SDK core deprecates it for `toolApproval` — read the installed d.ts). Closest to eve's durability without the service, but dynamically built tool maps aren't shown in the docs; spike it first.

> **Be straight about this on camera.** eve is beta and the API will drift between the shoot and the upload. Pin `eve@x.y.z` in the repo, say the version out loud, and link the docs in the description. That reads as competence, not a caveat.

## Node catalogue

Every node is one file: zod `inputs` (generates the config form, validates before run), zod `outputs` (powers the variable picker before the workflow has ever run), a `credential` kind, an optional `handle()` for branching or `control()` for sleep and hooks, and `run()`. `v1` is built on camera, `v2` sits in the sidebar as coming soon.

### Triggers

- **Manual** `v1`: Run button with optional sample JSON.
- **Webhook** `v1`: Unique URL per workflow. Body, headers, query become the output.
- **Form** `v1`: Hosted public form page per workflow, fields defined in the node.
- **Schedule** `v1`: Cron or "every N minutes". **Publish** arms the Convex job and **Unpublish** disarms it (`lib/schedules-server.ts`, called from the `publishWorkflow` server action and from `POST /api/schedules`, which is kept for compatibility) — there is no separate Enable switch, because a published workflow whose schedule was not also armed is a workflow that silently never fires.
- **Telegram message** `v1`: Bot receives a message. Simplest inbound trigger to demo from a phone.
- **Discord slash command** `v2`: Interactions endpoint, Ed25519, deferred reply then PATCH with the result.
- **Slack mention** `v2`: Events API `app_mention`, challenge handshake, 3s ack.
- **Stripe event** `v2`: Pick event types, per-connection signing secret.
- **GitHub event** `v2`: `issues` / `pull_request` with action filter.
- **Email received** `v2`: Resend inbound on a subdomain.
- **Airtable record changed** `v2`: Webhook + payload pull + 5-day refresh.

### Logic and control

- **Condition** `v1`: Left value (template), operator dropdown (equals, contains, greater than, is empty, matches regex), right value. Handles `true` / `false`. No `eval`.
- **Switch** `v1`: One value, N named cases plus `default`. Handle ids are the case names. What Classify feeds into.
- **Set / Transform** `v1`: Key-value pairs with templates, builds a clean object for the next node.
- **Wait** `v1`: Duration or timestamp. Returns `control: { kind: "sleep" }`; the workflow calls `sleep()`. "Wait 3 days then follow up" costs nothing while waiting.
- **Approval** `v1`: Posts to Slack, Discord or Telegram with Approve / Reject, then `createHook()`. Handles `approved` / `rejected`. The showpiece.
- **Wait for webhook** `v2`: Same hook mechanism; the node shows a URL containing the token, a later POST resumes the run with its body.
- **Loop** `v1`: Array in, downstream chain once per item with `{{ $item }}`, results collected. Sequential in v1; chunks into child runs in v2.
- **Filter · Merge · Code** `v2`: Filter is Condition over an array. Merge waits for all parents. Code needs a sandbox (Vercel Sandbox is the obvious one on this stack).

### AI

- **LLM** `v1`: Connection picker (any AI provider), model picker from the fetched list, prompt template. `generateText`.
- **Extract** `v1`: User-defined field list → zod schema → `Output.object`. Typed output appears in the variable picker.
- **Classify** `v1`: Fixed labels, `Output.choice`. Pairs with Switch.
- **Agent** `v1`: Goal prompt, tool checklist (from the user's connections), max steps, optional output schema. Calls eve. Shows the agent's tool calls as sub-rows under the node.
- **Generate image** `v1`: fal, OpenAI or Gemini. `generateImage`, result stored in Vercel Blob, URL in the output. Post it to Discord for the payoff.
- **Text to speech** `v2`: ElevenLabs or OpenAI. `generateSpeech` to Blob; send as a Telegram voice note.
- **Transcribe** `v2`: Groq Whisper, Deepgram, ElevenLabs Scribe. Audio URL in, text out.
- **Builder** `v1`: Not a node: the Pro-only agent in the side panel that builds workflows from a prompt. See [The Builder agent](#builder).

### Actions

- **Slack: Post message** `v1`: Channel picker from `conversations.list`, Block Kit optional. Outputs `ts`.
- **Discord: Post message** `v1`: Webhook or bot connection, content or embed, optional image attachment.
- **Telegram: Send message** `v1`: Chat picker from discovered ids, HTML parse mode. Photo and voice variants in v2.
- **Send email (Resend)** `v1`: From the app's domain, no connection needed. First action node built.
- **Notion: Create page** `v1`: Data source picker, title and mapped properties.
- **Airtable: Create record** `v2`: Base and table pickers from the Meta API, `typecast: true`.
- **Linear: Create issue** `v2`: Team picker, title, description. GraphQL, bare key header.
- **Teams · WhatsApp · GitHub** `v2`: Adaptive Card post, Twilio sandbox message, create issue / comment.
- **HTTP Request** `v1`: Method, URL, headers, body, optional connection to inject a bearer token. Makes everything else optional.

## Build order for the video

Ordered so something runs durably inside the first 25 minutes and each chapter adds one visible capability. Rough on-camera minutes for a 90 to 120 minute cut; this is a big one, or two parts.

1. **Clerk orgs + Convex + canvas** _(12 min)_ — Clerk with Organizations, Convex integration activated, `workflows` table keyed by org. React Flow with node sidebar, drag, connect, minimap, saving graph JSON through a mutation on change. Switch org, watch the list change.
2. **Workflow SDK: Manual → HTTP Request → Send email** _(12 min)_ — `withWorkflow`, `runGraph`, `runNode`, `start()` from a server action. Steps write to Convex through the shared-secret mutation; the canvas lights up from `useQuery`. Open `npx workflow web` and show the step trace. No credentials yet, so it can't stall.
3. **Templates and the variable picker** _(6 min)_ — `{{ node.field }}` resolution, picker from upstream `outputs` schemas.
4. **Vault + first AI connection** _(8 min)_ — `seal` / `open`, connections table, masked list. Paste an Anthropic key, "Test connection" hits `/v1/models` and fills the model picker. LLM node runs.
5. **Extract, Classify, Condition, Switch** _(8 min)_ — `Output.object`, `Output.choice`, two handles, one branch greys out. Add a second provider (OpenAI or Groq) to show the dropdown is real.
6. **Form trigger** _(5 min)_ — Public form page → route → `start()`. The demo now begins with a real user action.
7. **Discord and Telegram** _(7 min)_ — Two token-paste connectors, two posts, phone on screen for the Telegram ping. Telegram inbound trigger via `setWebhook`.
8. **Generic OAuth + Slack** _(10 min)_ — Provider config, state, callback, encrypt, channel picker. Then Notion as "same module, new config".
9. **Wait and Approval** _(8 min)_ — `sleep()` for a Wait node, then the Approval node: Slack buttons, `createHook`, interactivity route calls `resumeHook`. Press the button on a phone.
10. **Agent node with eve** _(12 min)_ — `withEve`, the Runtime agent directory, `defineDynamic` returning the org's connector tools, `eve/client` from the step. Drop a skill markdown file in and watch it change behaviour.
11. **Schedule trigger** _(5 min)_ — Convex as the alarm clock, no cron server anywhere. Set "every 2 minutes", press **Publish** (which is what arms it), and let it fire once while you talk. On Free the same press is refused with the plan's hourly floor, which is the gate worth showing.
12. **Clerk Billing** _(10 min)_ — Plans for Organizations with feature slugs, `<PricingTable for="organization" />`, `<Show when={{ feature: "org:pro_connectors" }}>` on the Pro node cards, `has()` in the run route, `PLAN_LIMITS` in the `createWorkflow` mutation, billing webhook into Convex. Hit the 3-workflow wall on Free, upgrade on the test gateway, wall disappears.
13. **The Builder agent** _(15 min)_ — Second eve directory, the editing tools as Convex mutations, `request_connection` with `ask()` and the credential widget. Type the climax workflow into the box and watch the canvas draw itself, pause for a Slack connect, carry on. Then run it.

### The climax workflow

Built by the Builder from one sentence, then triggered by one form submission. It touches five connectors and pauses for a human, and every step produces something you can cut to on screen.

- Form: "Work with Sonny" → Extract (name, company, budget, timeline) → Classify (hot / warm / cold) → Switch
  - **hot**: Approval in Slack (run sleeps) → Agent: research the company, draft a reply → Send email → Notion: create page → Telegram: "booked 🔥"
  - **warm**: Send email: case studies → Wait 3 days → Send email: follow-up
  - **cold**: Notion: create page → Discord: log

## Gotchas, ranked by how likely they are to eat a take

- **Workflow SDK**: Step arguments and return values are recorded in the run log and visible in the dashboard. Pass `connectionId`, never a decrypted key. `"use workflow"` code can't use global `fetch`, timers, `Buffer`, Node modules or `require`; `process.env` is a read-only frozen snapshot; all I/O goes in steps.
- **Workflow SDK**: `start()` is step-backed in v5 and may be called in a workflow body; `getRun`/`resumeHook`/`getHookByToken` only in steps and routes. `createHook` must be called in the workflow, not a step. Renaming `runNode` or moving its file changes the step id: in-flight Vercel runs keep working on their pinned deployment, but `deploymentId: "latest"` upgrades, observability names and Local World runs break — so don't. The vendor workflow skill and the unversioned workflow-sdk.dev/docs pages describe v4; use /v5/docs.
- **eve**: Beta, Node 24+, versions daily. Pin it. It's a separate service on Vercel, but locally `withEve` spawns the eve dev server from `next dev` (set `EVE_BASE_URL` to reuse one). Durable tools (the ones that can `ask()`) must be static files in `agents/<name>/tools/`, never returned from `defineDynamic`.
- **Secrets**: Nothing the model can see may contain a secret: not a tool argument, not a tool result, not a Convex query the Builder reads. The credential widget saves through the app's own route and answers the ask with an id.
- **Clerk**: Core 3 removed `<Protect>`, use `<Show when={…}>`. Billing types in `@clerk/backend` are tagged public beta; pin versions. Features are booleans, so numeric limits are your own map. Seat limits over 20 need the $100/mo B2B add-on. Production billing needs your own Stripe account and a custom domain (no `*.vercel.app` for production Clerk instances).
- **Convex**: Steps on Vercel have no Clerk session; use the shared-secret public mutation pattern, and never rely on `setAdminAuth`, which is internal. Never return a whole `connections` document from a query; project the safe fields. Claim names on `getUserIdentity()` for org and plan are verified from source, not docs; log once in dev.
- **Signatures**: Every HMAC scheme (Stripe, Slack, GitHub, Airtable, Resend) signs the raw body. `await req.text()` first, parse after. Discord is Ed25519 over timestamp + body.
- **AI SDK 7**: ESM-only, Node 22+. `stepCountIs` became `isStepCount`, `system` became `instructions`. MCP client moved to `@ai-sdk/mcp`. `generateObject` is deprecated.
- **Model names**: OpenAI renamed its tiers in July, DeepSeek retired `deepseek-chat`, Gemini bumps monthly. Never hardcode; the picker pulls from the list endpoint at connect time and caches in `meta`.
- **AI Gateway**: Per-request BYOK works, but a failing user key falls back to your credits. Validate on connect and check provider metadata on responses.
- **Slack**: Ack Events API and interactivity posts within 3 seconds. First request is a `url_verification` challenge. Users can decline individual scopes now, so store granted scopes from the token response.
- **Discord**: Message triggers need a Gateway WebSocket, so triggers are slash commands only. Reply type 5 within 3s, then PATCH `/webhooks/{app}/{token}/messages/@original` (token lives 15 minutes).
- **Resend**: 403 without a `User-Agent` header. Free tier is 100 emails/day and inbound counts.
- **Notion**: `data_source_id`, not `database_id`. `Notion-Version: 2026-03-11`. Webhook subscriptions are UI-only and carry IDs only.
- **Teams**: Old incoming webhooks died in May 2026. Workflows URL + Adaptive Card (Message Cards also accepted).
- **Schedules**: `ctx.scheduler.cancel()` throws if the job it names has already completed — every re-arm and disarm checks `ctx.db.system.get(jobId).state.kind === "pending"` first. `APP_ORIGIN` on the Convex dev deployment is Convex's own copy, set separately from Vercel's; `http://localhost:3000` there is unreachable from Convex's cloud, so a local schedule test needs `npx convex dev --local` or a tunnel.

## Sources

- [Vercel Workflows overview](https://vercel.com/docs/workflows)
- [Vercel Workflows concepts](https://vercel.com/docs/workflows/concepts)
- [Vercel Workflows pricing and limits](https://vercel.com/docs/workflows/pricing)
- [Workflow SDK: workflows and steps](https://workflow-sdk.dev/docs/foundations/workflows-and-steps)
- [Workflow SDK: errors and retries](https://workflow-sdk.dev/docs/foundations/errors-and-retries)
- [Workflow SDK: hooks](https://workflow-sdk.dev/docs/foundations/hooks)
- [Workflow SDK: sleep](https://workflow-sdk.dev/docs/api-reference/workflow/sleep)
- [Workflow SDK: start()](https://workflow-sdk.dev/docs/api-reference/workflow-api/start)
- [Workflow SDK: streaming](https://workflow-sdk.dev/docs/foundations/streaming)
- [Workflow SDK: Next.js setup](https://workflow-sdk.dev/docs/getting-started/next)
- [Workflow SDK: durable agents](https://workflow-sdk.dev/docs/ai/building-durable-agents)
- [Stateful Slack bots with Vercel Workflows](https://vercel.com/kb/guide/stateful-slack-bots-with-vercel-workflow)
- [Introducing eve](https://vercel.com/blog/introducing-eve)
- [eve docs (Vercel)](https://vercel.com/docs/eve)
- [eve: execution model and durability](https://eve.dev/docs/concepts/execution-model-and-durability)
- [eve: dynamic capabilities](https://eve.dev/docs/guides/dynamic-capabilities)
- [eve: client](https://eve.dev/docs/guides/client/overview)
- [eve: tools](https://eve.dev/docs/tools)
- [eve: Next.js integration](https://eve.dev/docs/guides/frontend/nextjs)
- [AI SDK 7 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)
- [AI SDK: ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [AI SDK: structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [AI SDK: MCP tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
- [AI SDK: OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)
- [AI SDK: Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
- [AI SDK: Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)
- [AI SDK: AI Gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)
- [AI Gateway BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)
- [OpenAI list models](https://developers.openai.com/api/reference/resources/models/methods/list)
- [Anthropic list models](https://platform.claude.com/docs/en/api/models/list)
- [Gemini models endpoint](https://ai.google.dev/api/models)
- [OpenRouter get current key](https://openrouter.ai/docs/api-reference/api-keys/get-current-key)
- [AI SDK: ElevenLabs](https://ai-sdk.dev/providers/ai-sdk-providers/elevenlabs)
- [AI SDK: fal](https://ai-sdk.dev/providers/ai-sdk-providers/fal)
- [Slack OAuth v2](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)
- [Slack Events API](https://docs.slack.dev/apis/events-api/)
- [Slack request signing](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Discord webhooks](https://docs.discord.com/developers/resources/webhook)
- [Discord create message](https://docs.discord.com/developers/resources/message#create-message)
- [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Teams connector retirement](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)
- [Twilio WhatsApp sandbox](https://www.twilio.com/docs/whatsapp/sandbox)
- [Resend send email](https://resend.com/docs/api-reference/emails/send-email)
- [Resend inbound](https://resend.com/docs/dashboard/receiving/introduction)
- [Notion authorization](https://developers.notion.com/docs/authorization)
- [Notion data sources upgrade](https://developers.notion.com/docs/upgrade-guide-2025-09-03)
- [Airtable OAuth](https://airtable.com/developers/web/api/oauth-reference)
- [Airtable webhooks](https://airtable.com/developers/web/api/webhooks-overview)
- [Linear GraphQL API](https://linear.app/developers/graphql)
- [Linear webhooks](https://linear.app/developers/webhooks)
- [GitHub webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [eve: durable tools and ask()](https://eve.dev/docs/tools/workflows)
- [Clerk Billing for B2B](https://clerk.com/docs/nextjs/guides/billing/for-b2b)
- [Clerk Billing overview and fees](https://clerk.com/docs/guides/billing/overview)
- [Clerk <Show> component](https://clerk.com/docs/nextjs/reference/components/control/show)
- [Clerk billing webhooks](https://clerk.com/docs/nextjs/guides/development/webhooks/billing)
- [Clerk getOrganizationBillingSubscription](https://clerk.com/docs/reference/backend/billing/get-organization-billing-subscription)
- [Clerk seat-based plans](https://clerk.com/docs/guides/billing/seat-based-plans)
- [Clerk session token claims (pla, fea, o)](https://clerk.com/docs/guides/sessions/session-tokens)
- [Clerk Core 3 changelog](https://clerk.com/changelog/2026-03-03-core-3)
- [Convex + Clerk](https://docs.convex.dev/auth/clerk)
- [Convex auth (server-to-server shared secret guidance)](https://docs.convex.dev/auth)
- [Convex: Clerk webhook sync example](https://docs.convex.dev/auth/database-auth)
- [Convex useQuery](https://docs.convex.dev/client/react)
- [Convex on Vercel](https://docs.convex.dev/production/hosting/vercel)
- [Clerk getUserOauthAccessToken](https://clerk.com/docs/reference/backend/user/get-user-oauth-access-token)
- [Nango pricing](https://nango.dev/pricing)
- [n8n encryption key rotation](https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/rotate-encryption-keys.md)
- [OWASP cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [React Flow Handle](https://reactflow.dev/api-reference/components/handle)
