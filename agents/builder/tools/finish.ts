import { defineTool } from "eve/tools";
import { z } from "zod";

import { finish } from "../lib/edits";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * The last call of a build: the workflow becomes `active` and the user is told how to set it off.
 *
 * A webhook trigger's URL is not returned — it carries the workflow's `webhookSecret`, and a secret
 * must never reach the model (CLAUDE.md rule 1). The user copies it from the node's own panel.
 *
 * **The session is closed on the other side, not here.** This tool cannot end its own session: a
 * tool runs *inside* the turn, and the only supported way to retire a session is `reset()` from a
 * client (`node_modules/eve/dist/src/client/session.d.ts`). So `components/canvas/BuilderPanel.tsx`
 * watches for this tool's result, lets the finishing turn settle, and resets the durable session —
 * otherwise eve parks it at `session.waiting` and its `workflowEntry` run stays Active until the
 * agent's `limits.sessionTimeoutMs`. `FINISH_TOOL` in `lib/builder-protocol.ts` is the name the
 * panel matches on, so renaming this file's tool means renaming that too.
 *
 * **Publishing goes through the app, not through Convex.** A Schedule trigger's "on" is a status
 * write *and* a durable scheduler run sleeping until the next occurrence, and only the Next app can
 * `start()` one (`lib/schedules-server.ts`). While this tool wrote the status itself, a
 * schedule-triggered workflow it finished was live in the canvas and never fired. It now calls
 * `POST /api/engine/publish`, which runs the same `applyPublish()` the Publish button runs — so a
 * plan that refuses the interval leaves the workflow *unpublished* and says so, and the model can
 * slow the schedule down with `configure_node` and call this again.
 */
export default defineTool({
  description:
    "Publish the workflow — mark it active, start its schedule if it has one — and summarise it " +
    "for the user. Call validate_workflow first and fix every problem it reports; this is the " +
    "last thing you do.",
  inputSchema: z.object({
    summary: z.string().describe("Two or three sentences: what the workflow does, in plain words."),
  }),
  async execute({ summary }, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await finish(session, summary);
    });
  },
});
