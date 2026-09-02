# Kickoff prompt for Claude Code

Open a terminal in the `papaflow` folder, run `claude`, press Shift+Tab until it says plan mode, and paste this as the first message:

---

Read CLAUDE.md and docs/PLAN.md fully before doing anything.

We're starting Phase 1 (Foundation) from the build phases in CLAUDE.md. Scaffold the project:

- Next.js App Router with TypeScript, pnpm, Tailwind, shadcn/ui (button, input, dialog, sheet, dropdown-menu, badge, tabs, tooltip, sonner).
- Clerk with Organizations enabled and the native Convex integration (no JWT template; the session token carries `aud: "convex"`). `ConvexProviderWithClerk` in a client provider component.
- Convex with the initial schema from CLAUDE.md ("Convex tables"), every table indexed by `orgId`. Include the `clerk-webhook` httpAction with svix verification handling `organization.*`, `organizationMembership.*`, and the billing `subscription*.*` events into `organizations`, `memberships`, `orgPlans`.
- React Flow canvas at `app/(app)/w/[workflowId]` with a node sidebar, drag-to-add, connect, minimap and controls. Graph JSON saves to Convex on change (debounced) with a `version` counter. Custom node component with a status ring (idle / running / success / failed) we'll drive in Phase 2.
- `nodes/` with `defineNode` and the registry, plus three real nodes to prove the pattern: `manual.trigger`, `http.request`, `email.send` (Resend).
- A workflow list page per org and an org switcher in the header.

Before writing files, give me the plan: the file tree you'll create, the Convex schema as code, the package versions you intend to pin (check npm for current versions of `convex`, `@clerk/nextjs`, `@xyflow/react`, `zod`, `ai`), and anything in CLAUDE.md you think is wrong for the installed versions. Then wait for my go.

Don't install `workflow` or `eve` yet; that's Phase 2 and Phase 10.

---

## After Phase 1

Each later phase starts the same way: "Read CLAUDE.md and the relevant section of docs/PLAN.md, then plan Phase N." The PLAN.md sections that matter per phase:

| Phase | PLAN.md sections |
|---|---|
| 2 Engine | Runs on Vercel Workflows, Triggers (Manual) |
| 3 Templates + logic | Node catalogue (Logic and control) |
| 4 Vault + AI | Credential vault, AI connectors |
| 5 Triggers | Triggers |
| 6 Token connectors | Chat and app connectors (Discord, Telegram) |
| 7 OAuth | OAuth, Chat and app connectors (Slack, Notion, Airtable) |
| 8 Control | Runs on Vercel Workflows (Approval in Slack), Node catalogue |
| 9 Schedules | Triggers (Schedules without cron) |
| 10 Runtime agent | The Agent node and eve |
| 11 Billing | SaaS layer |
| 12 Builder | The Builder agent |

## Useful Claude Code habits for this build

- `/init` is not needed; CLAUDE.md already exists. If Claude Code offers to rewrite it, decline.
- Keep `docs/PLAN.md` open in the editor; when Claude proposes something that contradicts it, ask which is right and have it update the plan.
- Before Phases 10 and 12, run the eve spike described in CLAUDE.md in a scratch folder first. Paste the working code back into the main repo.
- Use `/clear` between phases so the context is the code, not the previous phase's chatter.
