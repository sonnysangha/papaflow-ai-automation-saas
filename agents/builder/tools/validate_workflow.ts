import { defineTool } from "eve/tools";
import { z } from "zod";

import { validate } from "../lib/edits";
import { requireBuilder } from "../lib/session";

/**
 * The same questions the engine would ask at run time — one trigger, known node types, inputs that
 * satisfy their schemas, edges that join real nodes by handles those nodes declare, nothing
 * orphaned, every credentialled node wired to a connection — asked before anyone presses Run
 * (`lib/validate-workflow.ts`).
 */
export default defineTool({
  description:
    "Check whether the workflow could actually run, and list everything that would stop it. " +
    "Always call this before finish, and fix what it reports.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const session = await requireBuilder(ctx);
    return await validate(session);
  },
});
