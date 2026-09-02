import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    "convex/_generated/**",
    "app/.well-known/**",
    // eve's build output: `next dev` writes a compiled agent bundle under the repo root and under
    // each agent root, and linting a 70k-line generated bundle is 7000 warnings about eve's own
    // code. Both paths are in `.gitignore` for the same reason.
    "**/.eve/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
