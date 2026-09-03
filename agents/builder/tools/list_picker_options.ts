import { defineTool } from "eve/tools";
import { z } from "zod";

import { pickOptions } from "../lib/pickers";
import { requireBuilder } from "../lib/session";
import { toolResult } from "../lib/tool-result";

/**
 * The dropdown a person would see, for the agent filling the same field blind.
 *
 * A Slack channel id, an Airtable base and table, the columns of that table, a Telegram chat, a
 * Notion database's properties, a provider's model list: every one of those is a remote object with
 * an id the user never types, and guessing one is how a workflow ends up writing empty rows into a
 * column that does not exist.
 *
 * The credential is opened inside the tool and dropped when it returns; only ids, labels and (for
 * an enum-like column) its type and accepted choices come back (CLAUDE.md rule 1). A connection
 * that is not this organisation's is refused before anything is opened.
 */
export default defineTool({
  description:
    "List the real options for a config field that has a picker — Airtable bases/tables/fields, " +
    "Slack channels, Telegram chats, Notion databases/properties, a provider's models. Use the " +
    "ids this returns; never invent a base id, a table name or a column name.",
  inputSchema: z.object({
    connectionId: z.string().min(1).describe("A connection id from list_connections."),
    kind: z
      .string()
      .min(1)
      .describe(
        'The list to fetch, as the node\'s field declares it: "models", "channels", "chats", ' +
          '"bases", "tables:{baseId}", "fields:{baseId}:{tableId}", "databases", ' +
          '"properties:{databaseId}". Substitute the ids you already chose.',
      ),
  }),
  async execute(args, ctx) {
    return await toolResult(async () => {
      const session = await requireBuilder(ctx);
      return await pickOptions(session, args);
    });
  },
});
