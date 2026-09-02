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
 */

const FIELD_ROW = z.object({ key: z.string().min(1), value: z.string() });

/** Airtable's documented backoff when it throttles a base and says nothing else. */
const AIRTABLE_BACKOFF = "30s";

function tokenFrom(credential: Record<string, unknown> | undefined): string {
  const apiKey = credential?.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new ConnectorError("This node needs an Airtable connection", 400);
  }
  return apiKey;
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
    fields: z.array(FIELD_ROW).default([]).describe("Column names and their values"),
  }),
  outputs: z.object({ id: z.string() }),
  async run({ inputs, credential }) {
    const token = tokenFrom(credential);

    const fields: Record<string, string> = {};
    for (const row of inputs.fields) fields[row.key] = row.value;

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
