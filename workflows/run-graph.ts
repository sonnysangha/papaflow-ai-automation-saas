import { createHook, sleep } from "workflow";

import { DONE_HANDLE } from "@/nodes/logic/loop";
import { loopBody, loopBodyNodes, nextNodes, unvisited } from "@/workflows/graph";
import {
  recordFinish,
  recordLoop,
  recordResume,
  recordSkipped,
  recordSlept,
  recordSuspend,
} from "@/workflows/steps/record";
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
 * A Loop is the one node the walk does not simply step past: the chain on its `each` handle is its
 * body, which runs here — sequentially, once per item, one step per node per pass — and the walk
 * resumes on `done` when the items are exhausted. `workflows/graph.ts` decides what that body is;
 * this function only drives it.
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
  // A Loop body is not part of the walk: those nodes run inside their loop, once per item, and the
  // frontier must never pick one up on its own (that would run the first pass twice).
  const bodyNodes = loopBodyNodes(graph);
  let frontier = nextNodes(graph, graph.triggerId, null).filter((id) => !bodyNodes.has(id));
  // The first frontier counts as visited too, or `unvisited` would call the nodes right after the
  // trigger "never reached" — harmless while they end up with a step row of their own, and wrong
  // the moment something asks the set what actually ran.
  const visited = new Set<string>([graph.triggerId, ...frontier]);

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

        // Wait node: suspends the run without holding compute. `runNode` left the step row open
        // (`waiting`), so the canvas says "Waiting" for the whole sleep and `recordSlept` is what
        // finally turns it green.
        if (r.control?.kind === "sleep") {
          await recordSuspend(executionId);
          await sleep(r.control.ms);
          await recordSlept(executionId, r.nodeId, output);
        }

        // Approval and Wait-for-webhook: suspend until something outside calls
        // `resumeHook(token, payload)`. The token is derived from the run, so the resumer only
        // needs ids it already has.
        if (r.control?.kind === "hook") {
          using hook = createHook<HookPayload>({ token: hookTokenFor(executionId, r.nodeId) });
          // Last thing before the await, on purpose: `createHook()` does not register its token
          // until the workflow suspends, and a step call is a suspension.
          await recordSuspend(executionId);
          output = await hook;
          // The branch can only be known now: an Approval's `approved`/`rejected` handle is the
          // resumer's answer, not the node's. A payload that names one wins over `handle(out)`.
          handle = handleFromPayload(output) ?? handle;
          await recordResume(executionId, r.nodeId, output, handle);
        }

        // Loop: the body runs here, once per item, before the run carries on down `done`.
        //
        // Sequential on purpose (v1): each pass sees the pass before it finish, and a body node's
        // step row is per-iteration, so a crash halfway through resumes on the item it died on
        // rather than replaying the ones that already happened.
        if (r.items) {
          const body = loopBody(graph, r.nodeId);
          // Not `results`: that name belongs to the frontier's step results, just above.
          const collected: unknown[] = [];

          for (let iteration = 0; body.length > 0 && iteration < r.items.length; iteration++) {
            const item = r.items[iteration];
            // Body outputs live for one pass: `{{ set_1.x }}` inside the body means "this item".
            // Downstream of `done` they are gone, and `{{ loop_1.results }}` is the way to read
            // what the loop produced — which is the only value that means the same thing twice.
            const passOutputs: Record<string, unknown> = { ...outputs };
            let last: unknown;

            for (const bodyId of body) {
              const b = await runNode({
                nodeId: bodyId,
                nodeType: graph.nodes[bodyId].data.nodeType,
                executionId,
                orgId,
                planSlug,
                node: graph.nodes[bodyId],
                outputs: passOutputs,
                trigger,
                item,
                iteration,
              });

              let bodyOutput = b.output;
              // Wait and Approval work inside a body too; the hook token carries the pass so two
              // suspended iterations of the same node cannot share an address.
              if (b.control?.kind === "sleep") {
                await recordSuspend(executionId);
                await sleep(b.control.ms);
                await recordSlept(executionId, bodyId, bodyOutput, iteration);
              }
              if (b.control?.kind === "hook") {
                using hook = createHook<HookPayload>({
                  token: hookTokenFor(executionId, bodyId, iteration),
                });
                await recordSuspend(executionId);
                bodyOutput = await hook;
                await recordResume(
                  executionId,
                  bodyId,
                  bodyOutput,
                  handleFromPayload(bodyOutput) ?? b.handle,
                  iteration,
                );
              }

              visited.add(bodyId);
              passOutputs[graph.nodes[bodyId].data.key] = bodyOutput;
              last = bodyOutput;
            }

            collected.push(last);
          }

          const loopOutput = { results: collected, count: r.items.length };
          await recordLoop(executionId, r.nodeId, loopOutput);
          output = loopOutput;
          // The walk continues past a Loop through `done`, never through `each`: the body already
          // ran. The step row keeps no handle, so the canvas still draws both edges as taken.
          handle = DONE_HANDLE;
        }

        outputs[graph.nodes[r.nodeId].data.key] = output;

        // A Condition/Switch node returns the handle to follow; everything else returns null and
        // follows its default output. `visited` keeps a diamond from running a node twice.
        for (const next of nextNodes(graph, r.nodeId, handle))
          if (!visited.has(next) && !bodyNodes.has(next)) {
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
