import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", environment: "node", include: ["tests/**/*.test.ts", "{lib,nodes,workflows,connectors}/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "convex", environment: "edge-runtime", include: ["convex/**/*.test.ts"] },
      },
    ],
  },
});
