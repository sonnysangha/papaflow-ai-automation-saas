// Module map for convex-test. `import.meta.glob` is a Vite/vitest feature; this file has two dots
// in its name so the Convex bundler skips it (bundler/index.ts: "Skipping … contains multiple dots").
export const modules = import.meta.glob("./**/*.ts");
