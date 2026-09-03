import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        // `.tsx` too: a component pure enough to render with `renderToStaticMarkup` is tested here,
        // in plain node, rather than dragging jsdom in for assertions about markup.
        test: { name: "unit", environment: "node", include: ["tests/**/*.test.{ts,tsx}", "{lib,nodes,workflows,connectors}/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "convex", environment: "edge-runtime", include: ["convex/**/*.test.ts"] },
      },
    ],
  },
});
