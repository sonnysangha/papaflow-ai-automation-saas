// The wire types between the canvas' stored graph, the `"use workflow"` orchestrator and the
// `"use step"` node runner. Every value here crosses a step boundary, so it must be plain JSON:
// the Workflow SDK serializes step arguments and return values into the run's event log (and
// shows them in the dashboard) — see CLAUDE.md rule 1, never put a secret in one of these.
// `data.key` is the node's human name in templates (`{{ http_request_1.body }}`): unique per
// workflow, `^[a-z][a-z0-9_]*$`, written by the canvas and derived by `toRunGraph` for graphs
// saved before keys existed. Run outputs are keyed by it; edges still use ids.
export type RunNode = { id: string; type: string; data: { nodeType: string; key: string; label: string; inputs: Record<string, unknown>; connectionId?: string } };
export type RunEdge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
export type RunGraph = { triggerId: string; nodes: Record<string, RunNode>; edges: RunEdge[] };
export type Trigger = { type: string; payload: unknown };
// `planSlug` is the plan snapshotted on the execution at run start: `runNode` gates a node's
// (and its connection's) `requiresFeature` against it, so a mid-run downgrade cannot change what a
// run in flight is allowed to do.
export type RunInput = { executionId: string; orgId: string; planSlug: string; graph: RunGraph; trigger: Trigger };
// `outputs` is keyed by node key, and `trigger`/`item` are the two reserved template roots: the
// step resolves `node.data.inputs` against `{ ...outputs, trigger: trigger.payload, $item: item }`.
// `iteration` is the 0-based pass a Loop is on: it is part of the step's identity (one `steps` row
// per node *per iteration*), which is what stops the idempotency guard in `runNode` from handing
// pass 2 the output pass 1 stored. Nodes outside a loop body leave it undefined.
export type NodeInput = { nodeId: string; nodeType: string; executionId: string; orgId: string; planSlug: string; node: RunNode; outputs: Record<string, unknown>; trigger: Trigger; item?: unknown; iteration?: number };
export type Control = { kind: "sleep"; ms: number } | { kind: "hook" } | undefined;
// `items` is only set by a node that expands the run (Loop): the normalised list the orchestrator
// iterates. It rides on the step's *return* value rather than its arguments, so nothing has to
// carry a copy of the data into every body step (CLAUDE.md rule 1: step arguments are recorded).
export type NodeResult = { nodeId: string; output: unknown; handle: string | null; control: Control; items?: unknown[] };
export type HookPayload = Record<string, unknown>;

/**
 * The hook token for one node of one run — the only address a resumer needs, and derivable from
 * ids the caller already has. `runNode` stores it on the `waiting` step row (`steps.hookToken`,
 * indexed by `by_hookToken`), `runGraph` opens `createHook({ token })` with it, and the resume
 * routes hand it straight back to `resumeHook`.
 *
 * It lives here because both sides need it and this module has no imports: `"use workflow"` code
 * may not reach into `lib/`, which is where the Node-only resume half lives.
 */
export function hookTokenFor(executionId: string, nodeId: string, iteration?: number): string {
  // A node on a loop body suspends once per pass, and each pass needs an address of its own —
  // `steps.by_hookToken` is a unique lookup, so two waiting rows may never share a token.
  return iteration === undefined
    ? `${executionId}:${nodeId}`
    : `${executionId}:${nodeId}:${iteration}`;
}
