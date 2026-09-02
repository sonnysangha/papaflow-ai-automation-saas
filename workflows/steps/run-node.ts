import { FatalError, getStepMetadata, RetryableError } from "workflow";
import { ZodError } from "zod";

import type { Id } from "@/convex/_generated/dataModel";
import { getStep, markStep } from "@/lib/engine-client";
import { featuresForPlan } from "@/lib/plans";
import { redact } from "@/lib/redact";
import { openFresh } from "@/lib/vault";
import { ConnectorError, type AnyNodeDef } from "@/nodes/define";
import { NODES } from "@/nodes/registry";
import { resolveTemplates } from "@/nodes/templates";
import { hookTokenFor, type NodeInput, type NodeResult } from "@/workflows/types";

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

  const { nodeId, nodeType, executionId, orgId, planSlug, node, outputs, trigger, item, iteration } =
    input;
  // Only available inside a real step invocation; `attempt` counts from 1 and rises with retries.
  const { attempt } = getStepMetadata();

  console.log("runNode:start", { executionId, nodeId, nodeType, attempt, iteration });

  try {
    const def = NODES[nodeType];
    // A graph referencing a node type this deployment does not have will never work: no retries.
    if (!def) throw new FatalError(`Unknown node type: ${nodeType}`);

    // The template context, built once: the run's outputs keyed by node key plus the two reserved
    // roots — `trigger` (the payload that started the run) and `$item` (the element this pass of a
    // Loop is on). A template that is exactly one reference keeps the raw type it points at, so
    // this is also how a node input becomes an object or a number.
    const context = { ...outputs, trigger: trigger.payload, $item: item };

    // One row per node *per iteration*: a Loop body node that already succeeded on pass 1 must not
    // hand pass 2 that answer (CLAUDE.md rule 7 still holds — it is the same node, a different step).
    const stored = await getStep(executionId, nodeId, iteration);
    if (stored?.status === "success") {
      // Replay: the work is done and the row proves it. `control` and `items` are recomputed rather
      // than stored, because both are pure functions of the output, the inputs and the definition —
      // and a Loop that came back from its own row still has to know what it was iterating.
      return {
        nodeId,
        output: stored.output,
        handle: stored.handle ?? null,
        control: def.control?.(stored.output),
        ...expansion(def, node.data.inputs, context),
      };
    }

    // The row id comes back from the mark that opens it: an Approval needs a short address for
    // itself *inside* the message it is about to post, and this is the only one that exists before
    // `run` has been called.
    const stepId = await markStep({
      executionId,
      orgId,
      nodeId,
      nodeType,
      status: "running",
      attempt,
      iteration,
    });

    let inputs: unknown;
    try {
      // `{{ key.path }}` first, schema second.
      const { value, warnings } = resolveTemplates(node.data.inputs, context);
      inputs = def.inputs.parse(value);

      // Layer three of the plan gate (CLAUDE.md rule 3): the sidebar dims what the org cannot use
      // and `/api/connections` refuses to create it, but this is the one that actually stops a run —
      // against the plan snapshotted on the execution, not the org's plan right now.
      const features = featuresForPlan(planSlug);
      assertFeature(features, def.requiresFeature);

      // The secret appears here and goes no further: it is passed to `run` and never stored,
      // returned or logged (CLAUDE.md rule 1). `inputs` only ever carries the `connectionId`.
      //
      // A node whose credential is optional (`email.send`: the org's own Resend account, or the
      // platform's key) runs without one rather than failing when none was chosen.
      const credential =
        def.credential && (!def.credentialOptional || hasConnectionId(inputs))
          ? await openCredential(inputs, orgId, features)
          : undefined;

      // The address this node can be resumed at, whether or not it turns out to want one: a node
      // that posts its own buttons (Approval) has to put the token in them, and it only learns
      // that it is suspending by returning `control` — after `run` has already sent the message.
      // Inside a Loop body it is per-pass: two waiting rows may not share a token.
      const hookToken = hookTokenFor(executionId, nodeId, iteration);

      const output: unknown = def.outputs.parse(
        await def.run({
          inputs,
          credential,
          orgId,
          executionId,
          nodeId,
          planSlug,
          hookToken,
          stepId,
        }),
      );

      const handle = def.handle?.(output) ?? null;
      const control = def.control?.(output);
      // Both kinds of suspension leave the node unfinished: a Wait is asleep and an Approval is
      // waiting on a hook, and neither has produced its final row yet. `runGraph` closes a sleeping
      // step (`recordSlept`) and a hooked one (`recordResume`) on the other side of the suspension,
      // which is what makes the canvas show "Waiting" for as long as the run really is.
      const waiting = control?.kind === "hook" || control?.kind === "sleep";

      await markStep({
        executionId,
        orgId,
        nodeId,
        nodeType,
        // A node that asked to suspend is not finished: the workflow stops on it, and a record
        // step closes the row on the far side.
        status: waiting ? "waiting" : "success",
        attempt,
        input: redact(inputs),
        output,
        handle: handle ?? undefined,
        // `by_hookToken` is how a resume route finds this step from nothing but the token in its
        // URL. Written only on the suspending mark (an `undefined` here leaves whatever the row
        // already had); a resume that has landed is refused by status, not by clearing the token.
        hookToken: control?.kind === "hook" ? hookToken : undefined,
        // Unresolved paths are configuration mistakes, not failures: the node ran with `""` where
        // the template was, and the row carries the explanation to the canvas.
        warnings,
        iteration,
      });

      // A node whose output describes sub-steps (the Agent node's tool calls) gets one child row
      // each, hanging off the row this step just wrote. After the parent mark on purpose: a child
      // pointing at a `parentStepId` that does not exist yet would be an orphan in the drawer.
      await recordChildren(def, output, { executionId, orgId, nodeId, stepId, attempt });

      // A Loop hands back the list it is iterating: the orchestrator needs the items themselves,
      // and this is the one place they exist without being copied into a step argument.
      const items = def.expand?.(inputs);

      return { nodeId, output, handle, control, ...(items ? { items } : {}) };
    } catch (error) {
      const message = describeError(error, node.data.label ?? nodeType);
      await markStep({
        executionId,
        orgId,
        nodeId,
        nodeType,
        status: "failed",
        attempt,
        input: redact(inputs),
        error: message,
        iteration,
      });
      throw asStepError(error, message);
    }
  } finally {
    console.log("runNode:end", { executionId, nodeId, nodeType, attempt });
  }
}

/**
 * The `{ items }` a Loop returns on the replay path, or `{}` for every other node.
 *
 * The list is not on the step row — the row holds the node's output, and a Loop's output is its
 * `results` — so a step that short-circuits on an already-successful row has to work it out again.
 * It can: `expand` is pure, and the template context on a replay is the same one that produced the
 * row in the first place, so the same items come back. A definition that has no `expand` (every
 * node but Loop) contributes nothing, and the returned object stays exactly `NodeResult`.
 */
function expansion(
  def: AnyNodeDef,
  raw: Record<string, unknown>,
  context: Record<string, unknown>,
): { items?: unknown[] } {
  if (!def.expand) return {};

  const { value } = resolveTemplates(raw, context);
  return { items: def.expand(def.inputs.parse(value)) };
}

/**
 * Writes one `steps` row per sub-step a node's output describes — today, one per tool call the
 * Agent node's agent made.
 *
 * The rows are addressed `${nodeId}#${index}` so each has its own identity in
 * `by_execution_node` (a `#` cannot appear in a graph node id, so they can never collide with a real
 * node), and `parentStepId` is what the runs drawer nests them under. `nodeType` carries the tool's
 * name behind an `agent.tool:` prefix: there is no registry entry to look a label up in, and the
 * name is the only interesting thing about the row.
 *
 * Idempotent by construction: `children` is a pure function of the output, `markStep` upserts by
 * that address, and a step replaying from its own successful row returns before it gets here.
 */
async function recordChildren(
  def: AnyNodeDef,
  output: unknown,
  context: {
    executionId: string;
    orgId: string;
    nodeId: string;
    stepId: Id<"steps">;
    attempt: number;
  },
): Promise<void> {
  const children = def.children?.(output);
  if (!children || children.length === 0) return;

  for (const [index, child] of children.entries()) {
    await markStep({
      executionId: context.executionId,
      orgId: context.orgId,
      nodeId: `${context.nodeId}#${index}`,
      nodeType: `agent.tool:${child.name}`,
      status: child.error ? "failed" : "success",
      attempt: context.attempt,
      input: redact(child.input),
      output: child.output,
      error: child.error,
      parentStepId: context.stepId,
    });
  }
}

/**
 * Opens the connection a node asked for, inside the step that is about to use it.
 *
 * Three things have to be true before a secret is handed to a connector: the row exists (the vault
 * throws otherwise), it belongs to the org whose run this is — an id from another org's graph must
 * look exactly like an id that was never there — and the plan covers whatever feature the connection
 * itself demands. The returned object is what `RunContext.credential` is: the provider slug and kind
 * alongside the opened secret's fields, so a node knows which vendor its key belongs to.
 */
async function openCredential(
  inputs: unknown,
  orgId: string,
  features: readonly string[],
): Promise<Record<string, unknown>> {
  const connectionId = (inputs as { connectionId?: unknown }).connectionId;
  if (typeof connectionId !== "string" || !connectionId) {
    throw new FatalError("This node needs a connection: choose one in its configuration.");
  }

  const row = await openFresh(connectionId);
  // Not "wrong org": a connection this run may not read is a connection that does not exist.
  if (row.orgId !== orgId) throw new FatalError("connection not found");

  assertFeature(features, connectionFeature(row));

  // `meta` is the non-secret half the connector's `test()` learned (a Resend account's verified
  // domains, a Telegram bot's known chats): a node may need it to refuse bad input before it calls
  // the provider. The secret is spread last so a field of the same name always wins.
  return { provider: row.provider, kind: row.kind, ...(row.meta ? { meta: row.meta } : {}), ...row.secret };
}

/** Whether a connection was actually chosen, as opposed to left empty in the config panel. */
function hasConnectionId(inputs: unknown): boolean {
  const connectionId = (inputs as { connectionId?: unknown }).connectionId;
  return typeof connectionId === "string" && connectionId.length > 0;
}

/**
 * A connector can demand a plan feature of its own (`pro_connectors` and friends). The vault does
 * not project the column yet, so it is read defensively rather than assumed absent — the day
 * `openFresh` starts returning it, the gate below starts enforcing it.
 */
function connectionFeature(row: object): string | null {
  const feature = (row as { requiresFeature?: unknown }).requiresFeature;
  return typeof feature === "string" ? feature : null;
}

/** The message the runs drawer shows, and the one the upgrade prompt is keyed off. */
function assertFeature(features: readonly string[], feature: string | null): void {
  if (feature && !features.includes(feature)) {
    throw new FatalError(`Upgrade required: ${feature}`);
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

  if (isZodError(error)) return new FatalError(message);

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
/**
 * What the runs page shows for a failed step. A zod failure means the node's settings are
 * incomplete, which is the user's to fix in the config panel, so it reads as such instead of a
 * dumped issue list; everything else keeps the connector's own message.
 */
export function describeError(error: unknown, nodeLabel: string): string {
  if (isZodError(error)) {
    const issues = (error as { issues?: Array<{ path?: PropertyKey[]; message?: string }> }).issues ?? [];
    const parts = issues.slice(0, 3).map((issue) => {
      const field = String(issue.path?.[0] ?? "input");
      if (field === "connectionId") return "Connection: choose a connection in the node's settings";
      const label = field
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase());
      return `${label}: ${issue.message ?? "invalid"}`;
    });
    return `"${nodeLabel}" is not set up yet — ${parts.join("; ") || "check its settings"}.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isZodError(error: unknown): boolean {
  return error instanceof ZodError || (error instanceof Error && error.name === "ZodError");
}
