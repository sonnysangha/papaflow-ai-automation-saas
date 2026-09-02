import { z } from "zod";

import { NOTION_API, notionHeaders } from "@/connectors/notion";
import { ConnectorError, defineNode } from "../define";

/**
 * A row in a Notion database, created under one of its data sources.
 *
 * Two calls, not one. A page's title lives under whatever the data source calls its title property
 * — "Name" in a fresh database, anything the user renamed it to afterwards — and posting to the
 * wrong key is a 400 ("<key> is not a property that exists"). So the schema is read first and the
 * title property is discovered per data source rather than guessed
 * (docs/research/connectors-data.md).
 *
 * Extra properties are written as `rich_text`, which is the type that accepts a plain string for
 * the widest set of columns. A property named the same as the title column is dropped rather than
 * allowed to overwrite the title.
 */

const PROPERTY_ROW = z.object({ key: z.string().min(1), value: z.string() });

/** The credential `runNode` opened, reduced to the one field this node uses. */
function tokenFrom(credential: Record<string, unknown> | undefined): string {
  const apiKey = credential?.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new ConnectorError("This node needs a Notion connection", 400);
  }
  return apiKey;
}

/** Every Notion failure becomes a `ConnectorError`; 429 carries Notion's own `Retry-After`. */
async function notionCall(
  token: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${NOTION_API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: notionHeaders(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ConnectorError(
      text || `Notion returned ${response.status}`,
      response.status,
      response.headers.get("retry-after") ?? undefined,
    );
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ConnectorError(`Notion returned a body that is not JSON: ${text.slice(0, 200)}`, 502);
  }
}

/** The name of the one property whose `type` is `"title"` — every data source has exactly one. */
function titlePropertyName(schema: Record<string, unknown>): string {
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) {
    throw new ConnectorError("That Notion data source returned no properties", 502);
  }

  for (const [name, property] of Object.entries(properties as Record<string, unknown>)) {
    if ((property as { type?: unknown })?.type === "title") return name;
  }

  throw new ConnectorError("That Notion data source has no title property", 400);
}

export const notionCreatePageNode = defineNode({
  type: "notion.createPage",
  name: "Notion: Create page",
  description: "Add a page (a row) to a Notion data source.",
  category: "data",
  icon: "FileText",
  credential: "notion",
  requiresFeature: "pro_connectors",
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    dataSourceId: z
      .string()
      .min(1)
      .meta({ picker: "dataSources" })
      .describe("The database's data source, from the connection's own list"),
    title: z.string().min(1),
    properties: z
      .array(PROPERTY_ROW)
      .default([])
      .describe("Extra columns, written as text"),
  }),
  outputs: z.object({ id: z.string(), url: z.string() }),
  async run({ inputs, credential }) {
    const token = tokenFrom(credential);

    const schema = await notionCall(token, `/data_sources/${encodeURIComponent(inputs.dataSourceId)}`);
    const titleProperty = titlePropertyName(schema);

    const properties: Record<string, unknown> = {};
    for (const row of inputs.properties) {
      properties[row.key] = { rich_text: [{ text: { content: row.value } }] };
    }
    // Last, so a row that names the title column cannot displace the title itself.
    properties[titleProperty] = { title: [{ text: { content: inputs.title } }] };

    const page = await notionCall(token, "/pages", {
      parent: { data_source_id: inputs.dataSourceId },
      properties,
    });

    if (typeof page.id !== "string") {
      throw new ConnectorError("Notion created no page id", 502);
    }

    return { id: page.id, url: typeof page.url === "string" ? page.url : "" };
  },
});
