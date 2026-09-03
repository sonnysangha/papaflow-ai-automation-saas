import { z } from "zod";

import { AIRTABLE_API } from "@/connectors/airtable";
import { ConnectorError, defineNode } from "../define";

/**
 * One record in an Airtable table.
 *
 * `typecast: true` is what makes a workflow's strings usable: without it a single-select or a date
 * column rejects anything that is not already the exact stored value, and every field a template
 * produced is a string. With it Airtable coerces — and creates missing select options — which is
 * the behaviour a no-code builder expects.
 *
 * Airtable allows 5 requests per second per base and answers a sixth with a 429 whose documented
 * remedy is "wait 30 seconds" — it sends no `Retry-After`, so the node supplies that number itself
 * (docs/research/connectors-data.md).
 *
 * `typecast` has a dark side, and it is why this node refuses an all-empty record. Templates that
 * do not resolve become `""` (`nodes/templates.ts` warns and substitutes the empty string rather
 * than failing the run), so a workflow whose fields all read `{{ trigger.name }}` against a trigger
 * that has no `name` used to create a blank row per run and report success. Empty values are now
 * dropped, and a record with nothing left in it is a 400 naming the columns — the mistake is in the
 * templates, and the run's step `warnings` say which ones.
 */

const FIELD_ROW = z.object({ key: z.string().min(1), value: z.string() });

/** Airtable's documented backoff when it throttles a base and says nothing else. */
const AIRTABLE_BACKOFF = "30s";

/** How many column names the refusal lists before it stops. */
const NAMED_COLUMNS = 8;

function tokenFrom(credential: Record<string, unknown> | undefined): string {
  const apiKey = credential?.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new ConnectorError("This node needs an Airtable connection", 400);
  }
  return apiKey;
}

/**
 * The fields worth sending: everything whose value is not blank after trimming.
 *
 * Dropping the blanks rather than sending them is deliberate on its own — an empty string sent to a
 * date or a number column is a 422 from Airtable, and sending nothing leaves the column at its
 * default. The refusal is what happens when there is nothing left at all.
 *
 * @throws ConnectorError 400 when every configured field resolved to nothing.
 */
export function fieldsToSend(rows: readonly { key: string; value: string }[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const row of rows) {
    if (row.value.trim().length > 0) fields[row.key] = row.value;
  }

  if (rows.length > 0 && Object.keys(fields).length === 0) {
    const named = rows.slice(0, NAMED_COLUMNS).map((row) => row.key);
    const rest = rows.length - named.length;
    throw new ConnectorError(
      "Every field was empty — check the templates feeding these columns: " +
        named.join(", ") +
        (rest > 0 ? `, and ${rest} more` : "") +
        ". No record was created. The step's warnings list the {{ templates }} that resolved to nothing.",
      400,
    );
  }

  return fields;
}

export const airtableCreateRecordNode = defineNode({
  type: "airtable.createRecord",
  name: "Airtable: Create record",
  description: "Add a record to an Airtable table.",
  category: "data",
  icon: "Table",
  credential: "airtable",
  requiresFeature: "pro_connectors",
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    baseId: z.string().min(1).meta({ picker: "bases" }),
    // The kind carries the chosen base: the table list only exists relative to one.
    tableId: z.string().min(1).meta({ picker: "tables:{baseId}" }),
    // The key half of each row is a column of the chosen table, so it gets a dropdown of its own:
    // `keyPicker` names the list, with the same `{sibling}` placeholders `picker` uses. The kind
    // needs both ids because a table only exists inside a base.
    fields: z
      .array(FIELD_ROW)
      .default([])
      .describe("Column names and their values")
      .meta({ keyPicker: "fields:{baseId}:{tableId}" }),
  }),
  outputs: z.object({ id: z.string() }),
  async run({ inputs, credential }) {
    const token = tokenFrom(credential);

    const fields = fieldsToSend(inputs.fields);

    const response = await fetch(
      `${AIRTABLE_API}/${encodeURIComponent(inputs.baseId)}/${encodeURIComponent(inputs.tableId)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new ConnectorError(
        text || `Airtable returned ${response.status}`,
        response.status,
        // Airtable documents "wait 30 seconds" and sends no header, so the default is supplied here.
        response.headers.get("retry-after") ??
          (response.status === 429 ? AIRTABLE_BACKOFF : undefined),
      );
    }

    let created: unknown;
    try {
      created = (JSON.parse(text) as { records?: unknown }).records;
    } catch {
      throw new ConnectorError(`Airtable returned a body that is not JSON: ${text.slice(0, 200)}`, 502);
    }

    const id = Array.isArray(created) ? (created[0] as { id?: unknown })?.id : undefined;
    if (typeof id !== "string") {
      throw new ConnectorError(`Airtable created no record: ${text.slice(0, 200)}`, 502);
    }

    return { id };
  },
});
