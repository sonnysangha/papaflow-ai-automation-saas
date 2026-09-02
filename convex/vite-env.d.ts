// `import.meta.glob` is provided by vitest (Vite) and used by convex-test's module map in test.setup.ts.
// This file has multiple dots in its name so the Convex bundler skips it while tsconfig still picks it up.
interface ImportMeta {
  glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
}
