// Template paths read off a value the last run actually produced, for the half of the picker a
// schema cannot describe: `http.request` declares `body: z.any()` and the manual trigger's output
// is whatever JSON the user pasted, so `outputPaths` stops exactly where the interesting fields
// start. Same shape and same depth as `nodes/paths.ts` so the two lists merge cleanly.
import type { OutputPath } from "@/nodes/paths";

/** `a.b.c` — three property levels, with `[0]` counting as one, matching `outputPaths`. */
const MAX_DEPTH = 3;

/** A run output can be a 10k-row API response; the picker only ever needs the first screens. */
const MAX_PATHS = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON-shaped names, matching the JSON Schema `type` strings `outputPaths` reports. */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return type === "object" || type === "string" || type === "number" || type === "boolean"
    ? type
    : "any";
}

function walk(value: unknown, prefix: string, depth: number, found: OutputPath[]): void {
  if (depth >= MAX_DEPTH || found.length >= MAX_PATHS) return;

  if (Array.isArray(value)) {
    if (value.length === 0) return;
    const path = `${prefix}[0]`;
    found.push({ path, type: typeOf(value[0]) });
    walk(value[0], path, depth + 1, found);
    return;
  }

  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (found.length >= MAX_PATHS) return;
    const path = prefix ? `${prefix}.${key}` : key;
    found.push({ path, type: typeOf(child) });
    walk(child, path, depth + 1, found);
  }
}

/**
 * Paths observed inside one node's recorded output, relative to the node (the picker prefixes
 * them with the node key). Arrays contribute `[0]` and are described by their first element;
 * an empty array, a scalar or `undefined` contributes nothing.
 */
export function pathsFromValue(value: unknown): OutputPath[] {
  const found: OutputPath[] = [];
  walk(value, "", 0, found);
  return found;
}
