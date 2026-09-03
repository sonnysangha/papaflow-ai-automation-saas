import { defineTool } from "eve/tools";
import { z } from "zod";

import { describeWorkflow } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * The graph as it stands, so the Builder never has to ask the user where anything is.
 *
 * Every node with its template key, type, label, position, stored configuration (templates exactly
 * as written, unresolved) and the handles an edge may leave it by; every edge as
 * `from → handle → to` in keys rather than ids; and the two derived facts a plan actually turns on:
 * `endNodes` (nothing wired out of them — where "add a step at the end" goes) and `orphanNodes`
 * (nothing wired into them — they will never run).
 *
 * Nothing here is a credential. A node's `inputs` carries `connectionId`s, which are ids the user
 * can read off the connections page, and the workflow's `webhookSecret` is not part of the graph
 * (CLAUDE.md rule 1).
 */
export default defineTool({
  description:
    "Read the current workflow: every node with its template key, type, label, position, stored " +
    "inputs and output handles, every edge, which nodes are end nodes (no outgoing edge) and which " +
    "are orphans. Call this before editing or answering any question about the graph — never ask " +
    "the user which node is where.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await describeWorkflow(session);
    });
  },
});
