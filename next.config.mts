import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  agentRules: false, // stop `next dev` from appending an agent-rules block to CLAUDE.md
  /* config options here */
  reactCompiler: true,
};

// `withWorkflow` wires the webpack and Turbopack loaders that transform `"use workflow"` and
// `"use step"`, and generates the `/.well-known/workflow/*` routes the runtime calls back into.
// `.mts` because `eve/next` (Phase 10) is ESM-only and will wrap this same config.
export default withWorkflow(nextConfig);
