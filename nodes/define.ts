// The one pattern every connector hangs off. A node is a zod-first description of its
// configuration (`inputs`), its result (`outputs`) and the I/O it performs (`run`).
// Nothing in `nodes/` may import React or Next: these files are shared with Convex and
// with the `"use step"` code that runs them.
import type { z } from "zod";

export type NodeCategory = "trigger" | "logic" | "ai" | "chat" | "data" | "action";

/** Returned by `control` so the engine can suspend the run: Wait → sleep, Approval → hook. */
export type Control = { kind: "sleep"; ms: number } | { kind: "hook" } | undefined;

export interface RunContext<I> {
  inputs: I;
  /** Decrypted connection secret, opened inside the step. Never logged, never returned. */
  credential?: Record<string, unknown>;
  orgId: string;
  executionId: string;
  nodeId: string;
  hookToken?: string;
}

export interface NodeDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  /** `namespace.name`, e.g. `http.request`. Stable: graphs store it. */
  type: string;
  name: string;
  description: string;
  category: NodeCategory;
  /** lucide icon name, resolved by the sidebar/canvas at render time. */
  icon: string;
  /** Connection kind this node needs, or null. */
  credential: string | null;
  /**
   * Set when that connection is a choice rather than a requirement: `email.send` uses the org's
   * own Resend key when one is picked and the platform key when it is not. `runNode` then skips
   * the vault instead of failing the step when no `connectionId` was configured.
   */
  credentialOptional?: boolean;
  /** Clerk feature slug required to run this node, or null. */
  requiresFeature: string | null;
  version: "v1" | "v2";
  /** Generates the config form and the JSON Schema handed to the Builder agent. */
  inputs: I;
  /** Powers the variable picker. */
  outputs: O;
  /** Source handle ids for the canvas; default `["out"]`. */
  handles?: (inputs: z.infer<I>) => string[];
  /** Condition/Switch return the id of the edge handle to follow. */
  handle?: (out: z.infer<O>) => string | null;
  control?: (out: z.infer<O>) => Control;
  run: (ctx: RunContext<z.infer<I>>) => Promise<z.infer<O>>;
}

/**
 * A node definition with its schemas erased — what the registry, the canvas and the engine
 * hold. `z.ZodType` on its own infers `unknown`, which makes every concrete definition
 * unassignable (`run` is contravariant in `ctx`), so the erased form uses `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNodeDef = NodeDef<z.ZodType<any, any>, z.ZodType<any, any>>;

export function defineNode<I extends z.ZodType, O extends z.ZodType>(def: NodeDef<I, O>): NodeDef<I, O> {
  return def;
}

/**
 * Thrown by a node's `run` when the remote service refuses the call. Phase 2 maps this onto
 * the Workflow SDK error kinds: 4xx → FatalError, 429 → RetryableError with `retryAfter`.
 */
export class ConnectorError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
