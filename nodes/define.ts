// The one pattern every connector hangs off. A node is a zod-first description of its
// configuration (`inputs`), its result (`outputs`) and the I/O it performs (`run`).
// Nothing in `nodes/` may import React or Next: these files are shared with Convex and
// with the `"use step"` code that runs them.
import type { z } from "zod";

export type NodeCategory = "trigger" | "logic" | "ai" | "chat" | "data" | "action";

/** Returned by `control` so the engine can suspend the run: Wait → sleep, Approval → hook. */
export type Control = { kind: "sleep"; ms: number } | { kind: "hook" } | undefined;

/**
 * A sub-row a node's output implies: one tool call the Agent node's agent made, and nothing else so
 * far. `runNode` writes each of these as a `steps` row whose `parentStepId` is the node's own, so
 * the runs drawer can nest what happened inside a single step.
 */
export type ChildStep = {
  /** What the row is called in the drawer — the tool's name. */
  name: string;
  input?: unknown;
  output?: unknown;
  /** Set when the call failed; the row is recorded `failed` rather than `success`. */
  error?: string;
};

export interface RunContext<I> {
  inputs: I;
  /** Decrypted connection secret, opened inside the step. Never logged, never returned. */
  credential?: Record<string, unknown>;
  orgId: string;
  executionId: string;
  nodeId: string;
  /**
   * The org's plan as it was when the run started, snapshotted on the execution. Optional because
   * only the Agent node needs it — it hands the plan to the eve agent so the agent's tool list is
   * gated the same way `runNode` gates the node itself (CLAUDE.md rule 3).
   */
  planSlug?: string;
  hookToken?: string;
  /**
   * The Convex id of this node's `steps` row, for a node that has to hand out a short address for
   * itself: Approval puts `approve:<stepId>` in its buttons because Telegram caps `callback_data`
   * at 64 bytes and `hookToken` is not bounded. The resume route reads the row back and derives the
   * token from it. It is not a secret and it is not an authorization — the route still verifies the
   * provider's signature and matches the row's org against the connection's.
   */
  stepId?: string;
}

/**
 * The plain-language explainer a node carries for the people configuring it.
 *
 * A node's `description` is one line in a list; this is the paragraph you want in front of you once
 * you have dropped the node on the canvas and the form is asking you questions. The config panel
 * renders it above the fields, and the Builder's catalogue may pass it through as read-only text.
 *
 * `outputs` is the other half of the same problem. A branching node's handle ids are the names the
 * *engine* uses — `true`, `each`, `default` — and they are stored in every saved graph, so they can
 * never change. This maps each one to the words a reader should see instead: the canvas draws the
 * handle under them, the edge leaving it is labelled with them, and the id stays underneath as the
 * thing templates and stored edges address. A handle with no entry is shown as its own id, which is
 * what a Switch case wants — the case string the user typed is already the right label.
 */
export type NodeGuide = {
  /** Two or three short sentences, written for someone who has never used an automation tool. */
  summary: string;
  /** Handle id → the words it is shown under, e.g. `{ true: "yes", false: "no" }`. */
  outputs?: Record<string, string>;
};

export interface NodeDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  /** `namespace.name`, e.g. `http.request`. Stable: graphs store it. */
  type: string;
  name: string;
  description: string;
  category: NodeCategory;
  /**
   * How this node works, in plain words, for the config panel. Optional: a node whose one line
   * says everything (Send email, HTTP request) does not need a paragraph.
   */
  guide?: NodeGuide;
  /** lucide icon name, resolved by the sidebar/canvas at render time. */
  icon: string;
  /**
   * Connection this node needs, or null: a provider slug (`slack`), a family whose providers share
   * a prefix (`discord`), `ai` for any AI provider, or `any` for any single-token connection.
   */
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
  /**
   * The items this node expands the run into — Loop, and nothing else so far.
   *
   * A node's `run` is one step and a step cannot contain other steps, so a node that repeats part
   * of the graph can only describe the repetition: `runNode` calls this with the resolved inputs
   * and returns the list alongside the output, and `runGraph` runs the body once per item with
   * `{{ $item }}` bound to it. Pure and cheap — it is recomputed rather than stored, so a replayed
   * step that short-circuits on its own step row still knows what it was iterating.
   */
  expand?: (inputs: z.infer<I>) => unknown[];
  /**
   * The sub-steps this node's output describes — the Agent node's tool calls, and nothing else so
   * far. Pure and derived from the output, like `handle` and `control`, so a replayed step that
   * short-circuits on its own row does not write the children twice.
   */
  children?: (out: z.infer<O>) => ChildStep[];
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
