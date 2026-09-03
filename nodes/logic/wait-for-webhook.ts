import { z } from "zod";
import { defineNode } from "../define";

/**
 * Suspend the run until something calls back.
 *
 * Like the Webhook trigger, its configuration is a URL rather than a form — but this one only
 * exists while a run is sitting on it: the token is `${executionId}:${nodeId}`, so the address is
 * `${APP_ORIGIN}/api/wait/<executionId>:<nodeId>` and it is only knowable once the run has reached
 * this node. The config panel therefore shows the shape, and the runs drawer shows the concrete URL
 * on the `waiting` step row.
 *
 * `control` returns `{ kind: "hook" }`, which is what actually suspends the run: `runNode` writes
 * the step row as `waiting` with the token on it, `runGraph` opens `createHook({ token })` and
 * awaits it, and `app/api/wait/[token]/route.ts` calls `resumeHook(token, { body, headers })`.
 * The payload the route sends becomes this node's output, so `run` never produces a real value —
 * it only answers with the empty shape, which is what a replay of a run that has not been resumed
 * yet would see.
 *
 * The token is the whole authorization, exactly like the Webhook trigger's secret: anyone holding
 * the URL can resume this one node of this one run, and nothing else.
 */
export const waitForWebhookNode = defineNode({
  type: "logic.waitForWebhook",
  name: "Wait for a callback",
  description: "Hold the run until another system calls back with an answer.",
  category: "logic",
  guide: {
    summary:
      "Stop here until something on the outside says carry on. Every run that reaches this node " +
      "gets its own web address; whatever is sent to it wakes that one run and becomes this " +
      "node's output. There is nothing to fill in — the address is the setup.",
  },
  icon: "Webhook",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z
    .object({})
    .describe("Nothing to fill in: the address that wakes the run appears once a run reaches here."),
  outputs: z.object({
    /** Parsed JSON when the caller said JSON, the raw text otherwise, null for an empty body. */
    body: z.any(),
    /** Lower-cased, minus `authorization` and `cookie` — a step's output is stored and displayed. */
    headers: z.record(z.string(), z.string()),
  }),
  control: () => ({ kind: "hook" }),
  async run() {
    return { body: null, headers: {} };
  },
});
