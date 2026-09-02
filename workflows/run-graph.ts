import { createHook, sleep } from "workflow";

import { nextNodes, unvisited } from "@/workflows/graph";
import { recordFinish, recordResume, recordSkipped } from "@/workflows/steps/record";
import { runNode } from "@/workflows/steps/run-node";
import { hookTokenFor, type HookPayload, type RunInput } from "@/workflows/types";

/**
 * The branch a resumed hook asks for. Pure and tiny so it can live in workflow code: the payload
 * comes off the event log on every replay, and reading a field off it is deterministic.
 *
 * Anything that is not a non-empty string means "the node's own handle decides" — a Wait-for-webhook
 * body that happens to contain a `handle` number is data, not a routing instruction.
 */
function handleFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const handle = (payload as { handle?: unknown }).handle;
  return typeof handle === "string" && handle.length > 0 ? handle : null;
}

/**
 * The durable run: a breadth-first walk of the graph, one frontier at a time.
 *
 * This function is orchestration and nothing else (CLAUDE.md rule 4). It has no Node.js runtime, no
 * `fetch`, no timers — every side effect is a `"use step"` call, and every value it holds is
 * serialised into the event log so the run can be replayed after a crash, a deploy, or a 30-day
 * sleep. What looks like a plain `while` loop is therefore also the run's state machine: the
 * frontier, the visited set and the `outputs` map are rebuilt deterministically on every replay.
 *
 * The name and the path are permanent — they are the workflow's id
 * (`workflow//./workflows/run-graph//runGraph`).
 */
export async function runGraph({ executionId, orgId, planSlug, graph, trigger }: RunInput) {
  "use workflow";

  // The trigger's payload is its output: `startRun` already wrote its `success` step row.
  //
  // `outputs` is keyed by each node's template key, not by its id, because that is what a user
  // writes: `{{ manual_trigger_1.lead.email }}`. `runNode` resolves against this map plus the two
  // reserved roots (`trigger`, `$item`); edges and step rows keep using ids.
  const outputs: Record<string, unknown> = {
    [graph.nodes[graph.triggerId].data.key]: trigger.payload,
  };
  const visited = new Set<string>([graph.triggerId]);
  let frontier = nextNodes(graph, graph.triggerId, null);

  try {
    while (frontier.length) {
      // Fan-out: sibling branches run as parallel steps, and the SDK keeps their wake order
      // deterministic across replays.
      const results = await Promise.all(
        frontier.map((nodeId) =>
          runNode({
            nodeId,
            nodeType: graph.nodes[nodeId].data.nodeType,
            executionId,
            orgId,
            planSlug,
            node: graph.nodes[nodeId],
            outputs,
            trigger,
          }),
        ),
      );

      frontier = [];
      for (const r of results) {
        let output = r.output;
        let handle = r.handle;

        // Wait node: suspends the run without holding compute.
        if (r.control?.kind === "sleep") await sleep(r.control.ms);

        // Approval and Wait-for-webhook: suspend until something outside calls
        // `resumeHook(token, payload)`. The token is derived from the run, so the resumer only
        // needs ids it already has.
        if (r.control?.kind === "hook") {
          using hook = createHook<HookPayload>({ token: hookTokenFor(executionId, r.nodeId) });
          output = await hook;
          // The branch can only be known now: an Approval's `approved`/`rejected` handle is the
          // resumer's answer, not the node's. A payload that names one wins over `handle(out)`.
          handle = handleFromPayload(output) ?? handle;
          await recordResume(executionId, r.nodeId, output, handle);
        }

        outputs[graph.nodes[r.nodeId].data.key] = output;

        // A Condition/Switch node returns the handle to follow; everything else returns null and
        // follows its default output. `visited` keeps a diamond from running a node twice.
        for (const next of nextNodes(graph, r.nodeId, handle))
          if (!visited.has(next)) {
            visited.add(next);
            frontier.push(next);
          }
      }
    }

    await recordSkipped(executionId, orgId, unvisited(graph, visited));
    await recordFinish(executionId, "completed");
    return { executionId, status: "completed" as const };
  } catch (err) {
    // A step that exhausted its retries (or threw a FatalError) fails the run: record why, then
    // rethrow so the SDK marks the run failed too and the trace shows the original error.
    await recordFinish(executionId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
