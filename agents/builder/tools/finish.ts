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
 * One thing this deliberately does *not* do: start a Schedule trigger. Activating the workflow is a
 * status write, and a schedule also needs a sleeping scheduler run that only the Next app can
 * `start()` (`lib/schedules-server.ts`). A schedule-triggered workflow the Builder finished is
 * published but unscheduled until someone presses Publish; nothing fires meanwhile, because there
 * is no scheduler run to fire it, and the trigger's panel says exactly that.
 */
export default defineTool({
  description:
    "Mark the workflow active and summarise it for the user. Call validate_workflow first and fix " +
    "every problem it reports; this is the last thing you do.",
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
