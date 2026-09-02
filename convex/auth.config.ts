import type { AuthConfig } from "convex/server";

// Native Clerk ↔ Convex integration: the session token itself carries aud="convex" once
// "Activate Convex integration" is switched on in the Clerk Dashboard (no JWT template).
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL!, // https://curious-cat-3256.clerk.accounts.dev (dev instance)
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
