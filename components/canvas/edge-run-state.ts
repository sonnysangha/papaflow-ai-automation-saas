// One edge's live appearance during a run, derived from the two nodes it connects. Pure and
// state-shaped rather than component-shaped — `Canvas` turns the result into `animated` and a
// Tailwind class, the same way `edge-label.ts` turns geometry into a point — so the rules are
// testable without React Flow, `runByNode` or an actual run.
import { DEFAULT_HANDLE, type NodeStatus } from "./graph-io";

/**
 * How far along this edge the run has gotten.
 *
 * `"neutral"` is "nothing to say yet" — before any run, while the source is still going, or a
 * branch this run did not take (the dimmed case `Canvas` already had). The other three are keyed to
 * the *target*'s status once the source has committed to this edge: `"running"` while the target is
 * queued, actively running, or waiting on something external (an Approval, a webhook) — all three
 * read as "the run is on this wire right now"; `"success"` once the target has finished; `"failed"`
 * if it has.
 */
export type EdgeRunTone = "neutral" | "running" | "success" | "failed";

export type EdgeRunState = {
  /** Whether the run actually followed this wire — a Condition/Switch's other arrows are `false`. */
  taken: boolean;
  tone: EdgeRunTone;
  /** React Flow's `animated` edge flag: dashed and moving. Only ever true alongside `"running"`. */
  animated: boolean;
};

const NEUTRAL: EdgeRunState = { taken: true, tone: "neutral", animated: false };
const UNTAKEN: EdgeRunState = { taken: false, tone: "neutral", animated: false };

/**
 * One edge's state, from the `RunNodeState.status` either side of it (`undefined` for a node the
 * latest run has no `steps` row for — idle, in `Canvas`'s own vocabulary; a Loop body already
 * carries only its latest pass, since `runByNode` is built from `latestStepByNode`).
 *
 * The source has to have *finished* (`"success"`) before this edge says anything: a Condition has
 * not chosen a branch while it is still running, so every edge leaving it stays neutral for exactly
 * as long as the node itself is unresolved — the same rule the dimming this replaces already
 * followed, which never lit up early either. A `"failed"` or `"waiting"` source is the same story:
 * nothing has left it yet.
 *
 * Once the source has succeeded, `sourceHandle` (the branch it actually recorded, or `undefined` for
 * a node with one way out) decides `taken` — the rule `Canvas` already applied for dimming. A taken
 * edge then reads the *target*'s status: no row yet (`undefined`, "queued" — the run is headed there
 * but has not started the step) and `"running"` both mean work is actively moving down this wire, so
 * both render identically, lit and animated. `"waiting"` is lit too — the run is still on this wire,
 * just paused on an Approval or a webhook — but does not animate, since nothing is moving while a
 * step sits there. `"success"` and `"failed"` are both finished, so neither animates. `"skipped"`
 * cannot normally happen on a taken edge's own target, but reads as neutral rather than as an error
 * if it ever does.
 */
export function edgeRunState({
  sourceStatus,
  sourceHandle,
  handle = DEFAULT_HANDLE,
  targetStatus,
}: {
  /** The edge's source node's latest status; `undefined` before the run has touched it. */
  sourceStatus: NodeStatus | undefined;
  /** The branch the source actually recorded (`RunNodeState.handle`), or `undefined` for one way out. */
  sourceHandle: string | undefined;
  /** This edge's own source handle — `edge.sourceHandle ?? DEFAULT_HANDLE`. */
  handle?: string;
  /** The edge's target node's latest status; `undefined` before the run has reached it. */
  targetStatus: NodeStatus | undefined;
}): EdgeRunState {
  if (sourceStatus !== "success") return NEUTRAL;

  const taken = sourceHandle ? handle === sourceHandle : true;
  if (!taken) return UNTAKEN;

  switch (targetStatus ?? "idle") {
    case "idle": // Queued: the source is done and this is the wire it is headed down next.
    case "running":
      return { taken: true, tone: "running", animated: true };
    case "waiting":
      return { taken: true, tone: "running", animated: false };
    case "success":
      return { taken: true, tone: "success", animated: false };
    case "failed":
      return { taken: true, tone: "failed", animated: false };
    default:
      return NEUTRAL; // "skipped"
  }
}
