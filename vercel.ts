import type { VercelConfig } from "@vercel/config/v1";

// Convex deploys first, then builds Next with NEXT_PUBLIC_CONVEX_URL injected for the target deployment.
// CONVEX_DEPLOY_KEY (prod key on Production, preview key on Preview) is the only Convex var on Vercel.
export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "npx convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL",
  functions: {
    "app/api/**/route.ts": { maxDuration: 300 },
  },
};
