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
 * Extra properties are shaped by the type the schema declares for that column, because Notion's
 * page property values are not interchangeable: a select wants `{ select: { name } }` and rejects
 * the `rich_text` array with "Select is expected to be select"
 * (https://developers.notion.com/reference/page-property-values). Everything the node has not been
 * taught — `rich_text` itself, and any type added after this was written — still goes as rich text,
 * the type that accepts a plain string for the widest set of columns. A property named the same as
 * the title column is dropped rather than allowed to overwrite the title.
 */

const PROPERTY_ROW = z.object({
  key: z.string().min(1),
  // One string per column, whatever the column's type — the config panel offers a data source's
  // own select/status options as values. A multi-select is the exception that needs more than one,
  // so a list is accepted there too; a comma-separated string means the same thing.
  value: z.union([z.string(), z.array(z.string())]),
});

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

/** A data source's `properties` map, keyed the way `POST /v1/pages` keys its own: by column name. */
function propertiesOf(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) {
    throw new ConnectorError("That Notion data source returned no properties", 502);
  }

  const columns: Record<string, Record<string, unknown>> = {};
  for (const [name, property] of Object.entries(properties as Record<string, unknown>)) {
    if (typeof property === "object" && property !== null) {
      columns[name] = property as Record<string, unknown>;
    }
  }
  return columns;
}

/** The name of the one property whose `type` is `"title"` — every data source has exactly one. */
function titlePropertyName(columns: Record<string, Record<string, unknown>>): string {
  for (const [name, property] of Object.entries(columns)) {
    if (property.type === "title") return name;
  }

  throw new ConnectorError("That Notion data source has no title property", 400);
}

/**
 * Column name → declared type, under both the map key and the property's own `name`, mirroring
 * `writableProperties` in `connectors/notion.ts`: the picker hands back `property.name`, and the
 * two agree, so indexing both means a schema keyed by id would still resolve.
 */
function typesByName(columns: Record<string, Record<string, unknown>>): Map<string, string> {
  const types = new Map<string, string>();
  for (const [key, property] of Object.entries(columns)) {
    if (typeof property.type !== "string" || !property.type) continue;
    types.set(key, property.type);
    if (typeof property.name === "string" && property.name) types.set(property.name, property.type);
  }
  return types;
}

/** Types whose value is the bare scalar: `{ url: "https://…" }`, and the same for email and phone. */
const SCALAR_TYPES: ReadonlySet<string> = new Set(["url", "email", "phone_number"]);

/**
 * The types that address a person, page or file by id. A text box cannot supply one, so they fail
 * here with a sentence naming the column, rather than as Notion's own "body failed validation".
 */
const UNSUPPORTED_TYPES: Readonly<Record<string, string>> = {
  relation: "a relation",
  people: "a people property",
  files: "a files property",
};

const SUPPORTED_TYPES =
  "text-like, select, status, checkbox, number, date, url, email and phone properties";

const TRUE_WORDS: ReadonlySet<string> = new Set(["true", "yes", "y", "1", "on"]);
const FALSE_WORDS: ReadonlySet<string> = new Set(["false", "no", "n", "0", "off"]);

type PropertyValue = string | string[];

/** A row's value as one trimmed string — a list is joined, which only the text types ever see. */
function asText(value: PropertyValue): string {
  return (Array.isArray(value) ? value.join(", ") : value).trim();
}

/** A row's value as a list: an array as it stands, or one comma-separated string split up. */
function asList(value: PropertyValue): string[] {
  const parts = Array.isArray(value) ? value : value.split(",");
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * One property row in the shape its column's type accepts
 * (https://developers.notion.com/reference/page-property-values).
 *
 * `undefined` means "send nothing": an empty value for a typed column, which on a create is
 * exactly what leaving the property out does, and is safer than posting `{ select: { name: "" } }`
 * for Notion to reject.
 */
function propertyValue(name: string, type: string, value: PropertyValue): unknown {
  const unsupported = UNSUPPORTED_TYPES[type];
  if (unsupported) {
    throw new ConnectorError(
      `${name} is ${unsupported}; PapaFlow can only write ${SUPPORTED_TYPES}`,
      400,
    );
  }

  const text = asText(value);

  switch (type) {
    case "select":
      return text ? { select: { name: text } } : undefined;

    case "status":
      return text ? { status: { name: text } } : undefined;

    case "multi_select": {
      const names = asList(value);
      if (names.length === 0) return undefined;
      return { multi_select: names.map((option) => ({ name: option })) };
    }

    case "checkbox": {
      if (!text) return undefined;
      const word = text.toLowerCase();
      if (TRUE_WORDS.has(word)) return { checkbox: true };
      if (FALSE_WORDS.has(word)) return { checkbox: false };
      throw new ConnectorError(
        `${name} is a checkbox, so its value has to be true or false — "${text}" is neither`,
        400,
      );
    }

    case "number": {
      if (!text) return undefined;
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        throw new ConnectorError(`${name} is a number property, but "${text}" is not a number`, 400);
      }
      return { number: parsed };
    }

    case "date": {
      if (!text) return undefined;
      // Passed through rather than reformatted: Notion tells a date from a moment by whether the
      // string carries a time, and that is the user's choice to make.
      if (Number.isNaN(Date.parse(text))) {
        throw new ConnectorError(
          `${name} is a date property, but "${text}" is not a date — use 2026-03-11 or a full ISO timestamp`,
          400,
        );
      }
      return { date: { start: text } };
    }

    default:
      if (SCALAR_TYPES.has(type)) return text ? { [type]: text } : undefined;
      // rich_text, and every type this node has not been taught: the widest one that takes a
      // string, written verbatim rather than trimmed.
      return {
        rich_text: [{ text: { content: Array.isArray(value) ? value.join(", ") : value } }],
      };
  }
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
    // Same idea as the data-source picker above, one level down: `keyPicker` turns the key half of
    // each row into a dropdown of that data source's writable columns. The title column is not
    // among them — it has its own field, and a row naming it is dropped below.
    properties: z
      .array(PROPERTY_ROW)
      .default([])
      .describe("Extra columns, each written in the shape its own type takes")
      .meta({ keyPicker: "properties:{dataSourceId}" }),
  }),
  outputs: z.object({ id: z.string(), url: z.string() }),
  async run({ inputs, credential }) {
    const token = tokenFrom(credential);

    const schema = await notionCall(token, `/data_sources/${encodeURIComponent(inputs.dataSourceId)}`);
    const columns = propertiesOf(schema);
    const titleProperty = titlePropertyName(columns);
    const types = typesByName(columns);

    const properties: Record<string, unknown> = {};
    for (const row of inputs.properties) {
      const shaped = propertyValue(row.key, types.get(row.key) ?? "", row.value);
      if (shaped !== undefined) properties[row.key] = shaped;
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
