// The wire types between the canvas' stored graph, the `"use workflow"` orchestrator and the
// `"use step"` node runner. Every value here crosses a step boundary, so it must be plain JSON:
// the Workflow SDK serializes step arguments and return values into the run's event log (and
// shows them in the dashboard) — see CLAUDE.md rule 1, never put a secret in one of these.
export type RunNode = { id: string; type: string; data: { nodeType: string; label: string; inputs: Record<string, unknown>; connectionId?: string } };
export type RunEdge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
export type RunGraph = { triggerId: string; nodes: Record<string, RunNode>; edges: RunEdge[] };
export type Trigger = { type: string; payload: unknown };
export type RunInput = { executionId: string; orgId: string; graph: RunGraph; trigger: Trigger };
export type NodeInput = { nodeId: string; nodeType: string; executionId: string; orgId: string; node: RunNode; outputs: Record<string, unknown>; item?: unknown };
export type Control = { kind: "sleep"; ms: number } | { kind: "hook" } | undefined;
export type NodeResult = { nodeId: string; output: unknown; handle: string | null; control: Control };
export type HookPayload = Record<string, unknown>;
