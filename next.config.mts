import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  agentRules: false, // stop `next dev` from appending an agent-rules block to CLAUDE.md
  /* config options here */
  reactCompiler: true,
};

// `withWorkflow` wires the webpack and Turbopack loaders that transform `"use workflow"` and
// `"use step"`, and generates the `/.well-known/workflow/*` routes the runtime calls back into.
//
// `withEve` mounts the eve Runtime agent at `/eve/agents/runtime/eve/v1/*`: in `next dev` it starts
// `eve dev` itself and rewrites to it (no second terminal), and on Vercel it writes a Build Output
// service so those routes never touch the Next.js function. The directory named here *is* the agent
// root — flat layout, no nested `agent/` — and `agents` must never be combined with `eveRoot`.
// Either wrapper order works (spiked 2026-09-02); this is the documented one.
// `.mts` because `eve/next` is ESM-only.
// Two agents, two Build Output services: `runtime` is the Agent node's, `builder` is the chat panel's
// (`/eve/agents/builder/eve/v1/*`).
export default withEve(withWorkflow(nextConfig), {
  agents: { runtime: "./agents/runtime", builder: "./agents/builder" },
});
