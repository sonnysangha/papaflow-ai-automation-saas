import { z } from "zod";
import { ConnectorError, defineNode } from "../define";

/**
 * The shortest suspension worth taking. A node configured for "0 seconds" still has to round-trip
 * through the SDK's timer, so a sub-second wait costs the same as a one-second one and only makes
 * the run's timeline harder to read. `until` is deliberately not clamped: a deadline that has
 * already passed means "carry on now", not "carry on in a second".
 */
const MIN_DURATION_MS = 1_000;

const waitInputs = z.object({
  mode: z
    .enum(["duration", "until"])
    .default("duration")
    .describe("Wait for a number of seconds, or until a specific moment"),
  seconds: z.number().min(1).default(30).describe("How long to wait, in seconds (duration mode)"),
  until: z
    .string()
    .optional()
    .describe("ISO 8601 date and time to wait for, e.g. 2026-09-02T17:30:00Z (until mode)"),
});

export type WaitInputs = z.infer<typeof waitInputs>;

/**
 * How long this node suspends the run for, in milliseconds — the whole of the Wait node's logic,
 * kept pure so it can be tested without a run and evaluated without a clock of its own.
 *
 * `now` is passed in rather than read here because the result is stored on the step row and the
 * orchestrator sleeps on it: a replay must recompute the same number from the same output, so the
 * only place `Date.now()` may be read is inside `run`, once.
 *
 * A `until` that cannot be parsed is a configuration mistake, so it is a 400 — `runNode` turns a
 * `ConnectorError` in the 4xx range into a `FatalError` and the run stops instead of retrying its
 * way through the same typo three times (CLAUDE.md rule 7).
 */
export function waitMs(inputs: WaitInputs, now: number): number {
  if (inputs.mode === "duration") {
    return Math.max(MIN_DURATION_MS, Math.round(inputs.seconds * 1_000));
  }

  const until = (inputs.until ?? "").trim();
  if (until.length === 0) {
    throw new ConnectorError("Wait: choose a date and time to wait until.", 400);
  }

  const at = Date.parse(until);
  if (Number.isNaN(at)) {
    throw new ConnectorError(`Wait: "${until}" is not a date and time I can read.`, 400);
  }

  // A deadline in the past is not an error — a run that took longer than expected to get here
  // simply has nothing left to wait for.
  return Math.max(0, at - now);
}

/**
 * Pause the run without holding compute.
 *
 * The node itself does nothing: it computes a duration and hands it back through `control`, and
 * `runGraph` turns that into `sleep(ms)` — the SDK suspends the run, releases the function, and
 * wakes it when the timer fires. There is no maximum, so "wait 7 days for the trial to end" costs
 * exactly as much as "wait 30 seconds".
 */
export const waitNode = defineNode({
  type: "logic.wait",
  name: "Wait",
  description: "Pause the run for a number of seconds, or until a date and time.",
  category: "logic",
  icon: "Clock",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: waitInputs,
  outputs: z.object({
    /** What the run actually suspended for, so the step row explains its own duration. */
    waitedMs: z.number(),
  }),
  control: (out) => ({ kind: "sleep", ms: out.waitedMs }),
  async run({ inputs }) {
    return { waitedMs: waitMs(inputs, Date.now()) };
  },
});
