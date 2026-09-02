// The paths a node's `outputs` offers the variable picker, read off the zod-generated JSON
// Schema rather than off the zod types, so every schema kind degrades to something printable.
import type { z } from "zod";
import { toJsonSchema, type JsonSchema } from "./schema";

export interface OutputPath {
  /** Template path relative to the node key, e.g. `body.items[0].id`. */
  path: string;
  /** JSON Schema type, or `"any"` where the schema does not constrain it. */
  type: string;
}

/** `a.b.c` — three property levels, with `[0]` counting as one. */
const MAX_DEPTH = 3;

/**
 * `properties`, `items` and `additionalProperties` are `boolean | JSONSchema` in draft 2020-12:
 * zod 4 emits `additionalProperties: false` for objects and `items: false` for tuples.
 */
function asSchema(value: unknown): JsonSchema | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : null;
}

/**
 * `z.any()` and `z.unknown()` produce `{}`, and unions of objects produce a bare `anyOf` — both
 * have no `type` at all. Nullable and scalar unions produce a `type` array (`["string","null"]`).
 */
function typeOf(schema: JsonSchema): string {
  const type = schema.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const named = type.filter((entry) => entry !== "null");
    return named.length > 0 ? named.join("|") : "null";
  }
  return "any";
}

function propertiesOf(schema: JsonSchema): [string, JsonSchema][] {
  const properties = schema.properties;
  if (!isRecord(properties)) return [];
  const entries: [string, JsonSchema][] = [];
  for (const [key, value] of Object.entries(properties)) {
    const child = asSchema(value);
    if (child) entries.push([key, child]);
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(schema: JsonSchema, prefix: string, depth: number, found: OutputPath[]): void {
  if (depth >= MAX_DEPTH) return;
  if (typeOf(schema) === "array") {
    const item = Array.isArray(schema.items) ? null : asSchema(schema.items);
    const path = `${prefix}[0]`;
    found.push({ path, type: item ? typeOf(item) : "any" });
    if (item) walk(item, path, depth + 1, found);
    return;
  }
  // A record is `type: "object"` with `additionalProperties` and no `properties`: its keys are
  // unknown, so it contributes its own path (type `"object"`) and nothing below it.
  for (const [key, child] of propertiesOf(schema)) {
    const path = prefix ? `${prefix}.${key}` : key;
    found.push({ path, type: typeOf(child) });
    walk(child, path, depth + 1, found);
  }
}

/**
 * Template paths for a node's `outputs`: object properties down to three levels (`a.b.c`),
 * arrays as `a[0]` typed by their items, records and `z.any()` as leaves. The root itself is
 * never listed — the picker prefixes each path with the node key (`{{ key.path }}`).
 */
export function outputPaths(schema: z.ZodType): OutputPath[] {
  const found: OutputPath[] = [];
  walk(toJsonSchema(schema), "", 0, found);
  return found;
}
