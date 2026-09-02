// zod 4 converts schemas to JSON Schema itself: `toJSONSchema` is re-exported by
// node_modules/zod/v4/classic/external.d.ts from ../core/json-schema-processors.js
// (zod 4.5.4). No zod-to-json-schema dependency.
import { z } from "zod";

export type JsonSchema = z.core.JSONSchema.BaseSchema;

/**
 * Draft 2020-12 JSON Schema for a node's `inputs`/`outputs`. Used for the config form and for
 * the Builder agent's tool arguments. `z.any()` becomes `{}` rather than throwing.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema);
}
