# Phase 12 — Builder Agent (eve) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one Opus subagent per task. Spike the `ask()` → custom widget round-trip first (scratchpad), reusing Phase 10's spike project.

**Goal:** A Pro-only chat panel where one sentence becomes a workflow: the Builder's tools write straight to the Convex workflow doc so the canvas draws itself live; when it needs a credential it parks the turn with `ask()` and the UI shows a credential widget that saves through `/api/connections` and answers with the connection id — the secret never reaches the model.

**Verified facts (docs/research/eve.md + docs/PLAN.md "The Builder agent"):** tools are static files in `agents/builder/tools/<name>.ts` (`defineTool` from `eve/tools`, filename = tool name); durable tools start `execute` with `"use workflow"` and may `await Promise.race([ask(ctx, { prompt, display: "confirmation", allowFreeform: true, options }), sleep("24h").then(() => ({ optionId: "cancel" }))])` (`ask` from `eve/workflow`, `sleep` from `workflow`); `remove_node` uses `approval: always()` from `eve/tools/approval`; React `useEveAgent({ agent: "builder", headers })` from `eve/react`; pending asks are `dynamic-tool` parts in state `approval-requested` with `part.toolMetadata.eve.inputRequest` (`{ requestId, kind, prompt, options, display, allowFreeform, action: { toolName, callId, input } }`); answer with `agent.respond([{ requestId, text: connectionId }])` or `optionId: "cancel"`; every tool's `execute` reads `ctx.session.auth.current.attributes.orgId` and re-checks the plan (`ai_builder`) via `lib/billing.ts#getOrgEntitlements`; model rule as in Phase 10 (string ids at `session.started`, live BYOK model only at `step.started`).

## Builder tools (`agents/builder/tools/`)
| Tool | Type | Does |
|---|---|---|
| `list_node_types` | plain | `nodeCatalogue(features)` (JSON Schema inputs, allowed flag) |
| `list_connections` | plain | `api.connections.list` projection for the org (never secrets) |
| `add_node` / `connect_nodes` / `configure_node` / `remove_node` | plain (remove: `approval: always()`) | Convex mutations in `convex/builder.ts` (`source: "builder"`, inputs validated with the node's zod schema, keys auto-generated, positions laid out left→right) |
| `request_connection` | durable | `ask()` → the chat panel renders `CredentialWidget` for `{ provider }` → widget saves via `POST /api/connections` → `respond({ text: connectionId })` → tool confirms ownership (`api.connections.get`) and returns `{ connectionId, label }` |
| `validate_workflow` | plain | `lib/validate-workflow.ts`: dangling edges, unconfigured required inputs, template refs to unknown keys, Condition without both branches, missing trigger |
| `finish` | plain | marks the workflow `active`, returns summary + trigger URL/form link |
| `test_run` (v2) | plain | starts a run with sample data and reads step rows back |

## Tasks
- [ ] Spike: `ask()` round-trip with a custom widget in the scratch project; confirm `inputRequest.action.toolName` and `respond` shapes; record in `docs/research/eve-spike.md`.
- [ ] Task 1: `convex/builder.ts` mutations (+ convex-test: validation errors surface as `ConvexError` with a message the agent can fix), `lib/validate-workflow.ts` (+ tests), `agents/builder/{agent.ts,instructions.md,channels/eve.ts,skills/<connector>.md}`.
- [ ] Task 2: the tools (above), `app/api/builder/session/route.ts` (`has({ feature: "org:ai_builder" })` → creates the session bound to a `workflowId`, stores `builderSessions`), usage counter (`usage.builderTurns`).
- [ ] Task 3: `components/canvas/BuilderPanel.tsx` (chat with streaming, narration, pending-ask detection) + `CredentialWidget.tsx` (reuses `AddConnectionDialog` step 2 with the provider preselected) + a "highlight nodes the Builder just placed" canvas effect (`lastEditSource === "builder"`).
- [ ] Phase check: type the climax sentence (docs/PLAN.md "The climax workflow"); nodes appear one by one; the agent parks on `request_connection` for Notion; paste an integration token in the widget; the agent resumes, validates, finishes; submitting the form runs the whole thing and pauses at Approval.
