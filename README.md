# PapaFlow

n8n-style workflow automation SaaS. Teams (Clerk organisations) bring their own AI keys and connect chat/app services as **connections** inside the product, draw workflows on a React Flow canvas (or describe them to a Builder agent), and every run executes durably on Vercel Workflows.

Stack: Next.js 16 · Convex · Clerk (Organizations + Billing) · Workflow SDK 5 · eve · AI SDK 7 · React Flow · shadcn/ui (Base UI).

## Setup

```bash
pnpm install
clerk env pull --file .env.local          # Clerk dev keys (app is linked: `clerk whoami`)
CONVEX_ALLOW_ANONYMOUS=false npx convex dev # first run creates/links the Convex dev deployment and writes CONVEX_* vars
cp .env.example .env.example.check         # compare variable names with .env.local
```

`.env.example` lists every variable. `ENGINE_SECRET` must also be set on Convex (`npx convex env set ENGINE_SECRET …`) and `CLERK_FRONTEND_API_URL` points Convex at the Clerk Frontend API. See `docs/PROVISIONING.md` for what exists and the dashboard-only steps.

## Commands

```bash
pnpm dev            # Next.js (Turbopack) — also boots the Workflow Local World and the eve dev server once those phases land
pnpm convex:dev     # Convex dev push/watch
pnpm typecheck      # tsc --noEmit
pnpm lint
pnpm test           # vitest: `unit` (node) + `convex` (edge-runtime, convex-test)
pnpm workflow:web   # local workflow run inspector (Phase 2+)
```

## How runs start

Two different things start a run, and only one of them is on by default.

**Run** (the button above the canvas) starts the workflow there and then, whatever state it is in.
That is how you test: a draft runs from Run exactly like a published workflow does, with the Manual
trigger's sample payload as the trigger output.

**Triggers** — webhook, form, schedule, and inbound chat and payment events — only fire for a
**published** workflow. A new workflow is a `Draft`; press **Publish** in the run bar to turn its
triggers on, and **Unpublish** to switch them off again (the badge then reads `Paused`). Until then:

| Trigger | Unpublished behaviour |
| --- | --- |
| Webhook (`/api/hooks/<id>/<secret>`) | `409 not_published` |
| Form (`/f/<id>`) | the page renders with a banner; a submit gets `409 not_published` |
| Schedule | the tick is refused (`409 not_published`); Convex disarms the job |
| Telegram / Stripe events | not listed as a listener; the provider still gets its `200` |

The URLs themselves work before publishing — they have to, or there would be nothing to paste into
the sending system.

### How schedules run

**Convex is the alarm clock, this app is the brain, Vercel Workflows is the muscle.** A schedule is
two things at once: a row in `schedules`, and one durable Convex scheduled job armed for the next
occurrence (`convex/schedules.ts`). Press **Publish** and the server action
(`app/(app)/w/[workflowId]/actions.ts#publishWorkflow`) does both — it validates the interval against
the plan, writes the row, then arms the job — and **Unpublish** disarms it and disables the row.
There is no separate Enable switch; the Schedule trigger's panel only reports what publishing left
behind, with the next three fire times and, in amber, why the last tick did not land if it did not.
If your plan will not run the interval you asked for (`free_org` is once an hour) publishing is
refused with a message saying so, and the workflow stays unpublished rather than becoming a published
workflow that never fires.

**A tick costs one Convex function call, not a sleeping process.** When the armed job wakes,
`convex/schedules.ts#fire` POSTs `/api/engine/schedule-tick`, which is where every decision actually
lives — is this still published, what does the plan allow, when is the next occurrence — and starts
the run through the *same* `startRun` every other trigger uses. The response tells Convex what to arm
next, so nothing polls and nothing sits **Active** in a dashboard between ticks the way a sleeping
Workflow SDK run used to: an hourly schedule is 24 Convex calls and 24 HTTP requests a day, whatever
your plan, and a Vercel Workflow run is spent only when a run actually starts.

Anything that moves the status *without* the action — the Builder's `finish`, an older client calling
`api.workflows.setStatus` — cannot strand a schedule: `/api/engine/schedule-tick` re-reads the
workflow on every tick and refuses one that is not `active` with `409 not_published`, which tells
Convex to disarm — the schedule resumes the moment it is published again, because publishing re-arms
it. A tick that cannot reach the app at all (a deploy in progress, a network blip) is retried three
times a minute apart, then Convex arms a fallback fifteen minutes out on its own so the schedule
recovers without anyone pressing Publish again; the trigger's panel shows the reason in amber
("Last tick could not reach the app: …") whenever that has happened.

**Locally, this needs a reachable `APP_ORIGIN`.** The alarm rings from Convex's own cloud, not from
your machine, so `APP_ORIGIN=http://localhost:3000` — fine for every other trigger, which your
browser or `curl` calls directly — is unreachable from there; a tick just retries and eventually
falls back, and nothing runs. Testing a real schedule locally needs either `npx convex dev --local`
(a Convex backend running on your own machine, which *can* reach `localhost`) or a tunnel (`ngrok
http 3000`, `cloudflared tunnel`) with the cloud dev deployment's `APP_ORIGIN` pointed at it
(`npx convex env set APP_ORIGIN <tunnel-url>`).

**On localhost**, the form page and the webhook URL work straight from your browser or `curl`, because
your machine is the one calling them:

```bash
curl -X POST http://localhost:3000/api/hooks/<workflowId>/<secret> \
  -H 'content-type: application/json' -d '{"hello":"world"}'
```

Telegram, Stripe, Slack and Discord are the other way round — *they* call *you*, so they need an
origin they can reach: the Vercel deployment, or a tunnel (`ngrok http 3000`, `cloudflared tunnel`)
with `APP_ORIGIN` set to it. Telegram additionally refuses to register a webhook that is not `https`.

## Templates

`lib/templates.ts` ships 13 starting points. Pick one from **New workflow → Templates** (or the gallery on an empty canvas); anything that needs a connection is listed on the card and greyed out on the canvas until you choose one on the Connections page.

| Template | What it shows off |
|---|---|
| Support inbox autopilot | Webhook → Classify → Route by value: bugs become GitHub issues, billing goes to a human by email, feature requests land in Notion, everything else gets an AI-drafted reply. |
| Morning tech digest | Weekday cron → Hacker News front page → For each story an LLM one-liner → one digest email. |
| Stripe payment → welcome sequence | Stripe `checkout.session.completed` → AI welcome email → Airtable ledger row → **sleeps three days** → check-in email. |
| Blog post with editorial approval | Form brief → outline → draft → Ask for approval in chat → Notion page, or an email back to the writer. |
| Website watchdog with escalation | Every 5 minutes: HTTP check → Telegram alert → pause 5 minutes → re-check → email escalation only if it is still down. |
| Telegram AI concierge | Telegram message → AI Agent (every connection in the workspace is a tool) → reply in the same chat. |
| Meeting notes → action items | Form → Extract a list of actions → For each one a GitHub issue → summary email. |
| Invoice intake with sign-off | Form → Extract vendor/amount/currency/due date → over 1,000 needs an approval → Airtable either way. |
| Lead intake triage | Form → Classify urgency → Telegram ping or a polite email. |
| Webhook to API call | Webhook → HTTP Request → Set values. |
| Hourly endpoint check | Hourly schedule → HTTP → email. |
| Approval before action | Manual → Ask for approval → both outcomes handled. |
| Loop over a list | Manual → For each item → collect results. |

## Runtime agent

The **AI Agent** node (`ai.agent`) does not call a model itself. It opens a session on the eve agent
in `agents/runtime/`, which `next.config.mts` mounts at `/eve/agents/runtime/eve/v1/*`:

```bash
curl http://localhost:3000/eve/agents/runtime/eve/v1/health
# {"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}
```

`pnpm dev` starts the eve dev server itself — no second terminal. Health is public; every session
route runs the auth walk in `agents/runtime/channels/eve.ts`: a Clerk session token (a person, from
the browser), then the engine's own five-minute HS256 token signed with `ENGINE_SECRET`
(`lib/eve.ts#mintEngineToken`), then `localDev()`. That last entry is why an unauthenticated
`POST …/eve/v1/session` is accepted under `pnpm dev` and a `401` in production.

**Which model an Agent node uses.** The node's connection and model dropdowns pick one of the org's
AI connections, and those two ids travel to the agent as JWT claims. `agents/runtime/agent.ts`
resolves the model twice: `session.started` returns the house model id (`openai/gpt-5.6-luna`,
through the Vercel AI Gateway), and `step.started` decrypts the org's key and returns a live AI SDK
model built from it. Step scope wins, so a run uses the organisation's own key and falls back to the
house model only when the connection is missing, revoked or unreadable. Locally the house model
needs `AI_GATEWAY_API_KEY`; on Vercel the deployment's OIDC token pays for it.

**Which tools it gets.** `agents/runtime/tools/connectors.ts` resolves them once per session from the
org's active connections: `slack_post`, `discord_post`, `telegram_send`, `notion_create_page` when
the workspace has that connection and its plan covers it, plus `http_request` always. Each tool calls
the same node `run()` the canvas uses, opening the credential inside the call. The default `bash`,
`read_file`, `write_file`, `web_fetch` and `agent` tools are disabled.

Tool calls appear in the run drawer as rows nested under the Agent node's own step.

**Sessions are closed when the node is done.** An eve session is a durable `workflowEntry` run plus a
`sessionTimeoutWorkflow` sleeping beside it, and finishing a turn does not end either — eve parks the
session at `session.waiting`, ready for a message that, for a workflow node, is never coming. So the
node calls `session.reset()` as soon as it has its answer (or its error), which terminates both runs;
`agents/runtime/agent.ts` also sets `limits: { sessionTimeoutMs: 5 * 60 * 1000 }` as the backstop for
a step that dies before it can. That limit is an **absolute lifetime from session creation, not an
idle timer** — eve 0.49.0 has no idle timeout — but it never interrupts work: a turn still running at
the deadline is allowed to settle first. eve's own default is 30 days, which is what left Agent-node
and chat runs sitting Active in Vercel's Workflows list. A waiting run holds no compute, so the cost
of the old behaviour was clutter and storage rather than money.

## Builder agent

Pro organisations get a **Build with AI** button in the canvas run bar. It opens a chat beside the
canvas whose tool calls edit the workflow document directly, so the graph draws itself while the
agent talks. The agent lives in `agents/builder/` and `next.config.mts` mounts it at
`/eve/agents/builder/eve/v1/*`:

```bash
curl http://localhost:3000/eve/agents/builder/eve/v1/health
# {"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}
```

**Who may open one.** `POST /api/builder/session` checks `has({ feature: "org:ai_builder" })`,
proves the workflow belongs to the caller's organisation and writes the `builderSessions` row before
any chat exists; the panel then opens the eve session itself with `useEveAgent({ agent: "builder" })`.
Every request carries the user's Clerk token as a bearer and the workflow id as an
`x-papaflow-workflow` header — `agents/builder/channels/eve.ts` verifies both and projects
`orgId`, `userId`, `plan` and `workflowId` into `ctx.session.auth.current.attributes`, which is where
every tool reads them from. (eve's `clientContext` reaches the model, not the tools, so it cannot
carry the workflow id; see `lib/builder-protocol.ts`.) Each tool then re-reads the plan from Clerk
before it does anything — three layers, and only the last two are enforcement.

**Its tools.** `list_node_types` and `list_connections` to look around; `add_node`, `connect_nodes`,
`configure_node` and `remove_node` to edit (each one a Convex mutation in `convex/builder.ts` that
bumps `version` with `lastEditSource: "builder"`); `validate_workflow` (`lib/validate-workflow.ts`)
and `finish` to land it. `remove_node` carries `approval: always()`, so deleting a node asks the user
first. The default `bash`, `read_file`, `write_file`, `web_fetch` and `agent` tools are disabled.

**Credentials.** `request_connection` is a durable tool: `"use workflow"`, `ask()` raced against a
24-hour `sleep`, and the turn parks with nothing running until the user answers. The panel renders
the ask as a credential widget (matched on `part.toolName === "request_connection"`), the pasted key
goes to `POST /api/connections` — never through the chat — and the widget answers with the new
connection's id alone.

**Ending a chat.** The Builder's session is a durable run too, so the panel retires it rather than
leaving it parked: when `finish` lands the transcript stays on screen, the composer reads `Finished`,
and the durable session is `reset()` — the next message opens a fresh one. **New chat** does the same
thing by hand. `agents/builder/agent.ts` sets `limits: { sessionTimeoutMs: 2 * 60 * 60 * 1000 }` for
the chats nobody closes; two hours rather than something tighter because the limit is an absolute
lifetime from creation rather than an idle timer, and a shorter one would end a conversation somebody
was still having.

**Live canvas.** Nothing in the panel writes to Convex. The agent's mutations arrive on the
`workflows.get` subscription the editor already holds, and `components/canvas/Canvas.tsx` adopts a
newer document stamped `lastEditSource: "builder"` even when a local save is pending, cancelling that
save rather than raising a version conflict.

## Deploying

Every push to `main` builds Production on Vercel (project `papaflow`, team `sonnysanghas-projects`): the build command in `vercel.ts` runs `npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`, which pushes the Convex functions (schedules' alarm clock among them) to the production deployment, compiles the Workflow SDK's `runGraph` and builds both eve services (`/eve/agents/runtime`, `/eve/agents/builder`). Live at https://papaflow.vercel.app.

Vercel env (Production): `CONVEX_DEPLOY_KEY`, `CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `ENGINE_SECRET`, `CREDENTIALS_KEK`, `APP_ORIGIN`. Convex production env: `CLERK_FRONTEND_API_URL`, `ENGINE_SECRET`, `APP_ORIGIN` (the schedule alarm clock's own outbound call to `/api/engine/schedule-tick` — set on the Convex deployment itself with `npx convex env set`, not inherited from Vercel's copy). Never set `NEXT_PUBLIC_CONVEX_URL` or `CONVEX_DEPLOYMENT` on Vercel.

`CONVEX_URL` is the production Convex deployment URL (`https://content-albatross-126.convex.cloud`), and it is what makes the two agents work in production. `convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` injects that name into the **Next build process**, where Next inlines it into the Next bundle; the eve services (`/eve/agents/runtime`, `/eve/agents/builder`) are separate Vercel services that only see the project's environment variables, so without `CONVEX_URL` every Builder tool answers "service unavailable" and the Runtime agent resolves no connector tools. `lib/engine-env.ts` reads `CONVEX_URL` first and falls back to `NEXT_PUBLIC_CONVEX_URL`, which is why local development needs nothing extra and why runs, triggers and schedules keep working inside the Next runtime without it — that fallback is written as the literal `process.env.NEXT_PUBLIC_CONVEX_URL` so Next's build-time substitution still applies to it. Do not add `CONVEX_URL` to `.env.local`: `npx convex dev` writes neither URL when it finds both names in that file.

## Stop points (things only you can do)

- **Your own AI key** — add an OpenAI / Anthropic / Gemini / Groq connection on the Connections page; the LLM, Extract, Classify, AI Agent and Builder features need it (or `AI_GATEWAY_API_KEY` locally for the house model).
- **Chat credentials** for a live Approval check — a Telegram bot token is the quickest; Slack needs its signing secret (the manifest in the Add-connection dialog already points Interactivity at `<origin>/api/events/slack`, the same URL for every connection); Discord needs the public key and the interactions URL.
- **Preview deployments** — generate a *preview* Convex deploy key in the Convex dashboard and add it as `CONVEX_DEPLOY_KEY` scoped to Preview, plus `APP_ORIGIN` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` on Preview. A preview key creates a Convex deployment **per branch**, so the agents on a preview also need `CONVEX_URL` set to that branch's deployment URL (see `docs/PROVISIONING.md`).
- **Team plan seats** — Clerk dashboard → Subscription plans → Plans for Organizations → Team → Seat-based.
- **Going to a real domain** — `clerk deploy` (owned domain + DNS + your Stripe account), then repeat the Convex integration for the production Clerk instance.

Details and the full provisioning log: `docs/PROVISIONING.md`.

## Docs

- `CLAUDE.md` — rules, layout, phases (corrected against installed versions on 2026-09-02)
- `docs/PLAN.md` — the full plan with research and code sketches
- `docs/PROVISIONING.md` — created resources and remaining dashboard steps
- `docs/research/` — verified API/version research digests used by every phase
- `docs/superpowers/plans/` — per-phase implementation plans
