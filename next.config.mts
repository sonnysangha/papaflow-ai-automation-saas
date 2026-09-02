import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false, // stop `next dev` from appending an agent-rules block to CLAUDE.md
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
