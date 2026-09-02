import { FatalError, getStepMetadata, RetryableError } from "workflow";
import { ZodError } from "zod";

import { getStep, markStep } from "@/lib/engine-client";
import { redact } from "@/lib/redact";
import { ConnectorError } from "@/nodes/define";
import { NODES } from "@/nodes/registry";
import type { NodeInput, NodeResult } from "@/workflows/types";

/**
 * One node, one step. This is the only place a connector's `run()` is called, and the only place
 * step rows for real work are written.
 *
 * The file path and the export name are permanent: the compiler derives the step id
 * (`step//./workflows/steps/run-node//runNode`) from them, and renaming either would change every
 * future run's identity in observability and break run upgrades (`deploymentId: "latest"`).
 *
 * Being a step means being re-runnable: the SDK retries on failure, and a replay can call this
 * again after the process died between the connector call and the record of it. The `getStep` guard
 * below is what makes that safe (CLAUDE.md rule 7) — a node that already succeeded returns its
 * stored output instead of calling the remote service twice.
 */
export async function runNode(input: NodeInput): Promise<NodeResult> {
  "use step";

  const { nodeId, nodeType, executionId, orgId, node } = input;
  // Only available inside a real step invocation; `attempt` counts from 1 and rises with retries.
  const { attempt } = getStepMetadata();

  console.log("runNode:start", { executionId, nodeId, nodeType, attempt });

  try {
    const def = NODES[nodeType];
    // A graph referencing a node type this deployment does not have will never work: no retries.
    if (!def) throw new FatalError(`Unknown node type: ${nodeType}`);

    const stored = await getStep(executionId, nodeId);
    if (stored?.status === "success") {
      // Replay: the work is done and the row proves it. `control` is recomputed rather than stored
      // because it is a pure function of the output and the node definition.
      return {
        nodeId,
        output: stored.output,
        handle: stored.handle ?? null,
        control: def.control?.(stored.output),
      };
    }

    await markStep({ executionId, orgId, nodeId, nodeType, status: "running", attempt });

    let inputs: unknown;
    try {
      // Phase 3 resolves `{{ nodeId.field }}` templates (and `input.item` for Loop) before this
      // parse; today the stored configuration is used as-is.
      inputs = def.inputs.parse(node.data.inputs);

      const output: unknown = def.outputs.parse(
        // `credential` stays undefined until Phase 4 opens the sealed connection here, inside the
        // step, so the plaintext never crosses a step boundary (CLAUDE.md rule 1).
        await def.run({ inputs, credential: undefined, orgId, executionId, nodeId }),
      );

      const handle = def.handle?.(output) ?? null;
      const control = def.control?.(output);

      await markStep({
        executionId,
        orgId,
        nodeId,
        nodeType,
        // A node that asked for a hook is not finished: the workflow suspends on it, and
        // `recordResume` closes the row when the payload arrives.
        status: control?.kind === "hook" ? "waiting" : "success",
        attempt,
        input: redact(inputs),
        output,
        handle: handle ?? undefined,
      });

      return { nodeId, output, handle, control };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markStep({
        executionId,
        orgId,
        nodeId,
        nodeType,
        status: "failed",
        attempt,
        input: redact(inputs),
        error: message,
      });
      throw asStepError(error, message);
    }
  } finally {
    console.log("runNode:end", { executionId, nodeId, nodeType, attempt });
  }
}

/**
 * Connector failure → retry policy (CLAUDE.md rule 7):
 * - 429 retries after the service's own `Retry-After`, or 30 seconds when it did not say;
 * - any other 4xx, and a configuration that fails its zod schema, is the user's to fix: no retry;
 * - everything else (5xx, network, bugs) is rethrown and gets the default 3 retries.
 */
function asStepError(error: unknown, message: string): unknown {
  if (error instanceof ConnectorError) {
    if (error.status === 429) {
      return new RetryableError(message, { retryAfter: retryAfter(error.retryAfter) });
    }
    if (error.status >= 400 && error.status < 500) return new FatalError(message);
  }

  if (isZodError(error)) return new FatalError(`Invalid node configuration: ${message}`);

  return error;
}

/**
 * HTTP `Retry-After` is either delta-seconds or an HTTP date; `RetryableError` takes milliseconds,
 * a duration string or a `Date`. Anything unparseable falls back to the 30 second default.
 */
function retryAfter(value: string | undefined): number | Date | "30s" {
  if (!value) return "30s";

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;

  const until = new Date(value);
  return Number.isNaN(until.getTime()) ? "30s" : until;
}

/** `instanceof` plus the name, so a second copy of zod in the bundle still classifies correctly. */
function isZodError(error: unknown): boolean {
  return error instanceof ZodError || (error instanceof Error && error.name === "ZodError");
}
