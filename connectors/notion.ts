// A Notion internal integration secret (`ntn_…`) is pasted, not granted: the user creates the
// connection at https://app.notion.com/developers/connections and shares the databases it may
// touch. `GET /v1/users/me` both proves the token and names the workspace it belongs to.
//
// Every REST call carries `Notion-Version: 2026-03-11` — the header "must be included in all REST
// API requests" and the value is the current one (docs/research/connectors-data.md). The version
// lives here rather than in the node so the connector and `notion.createPage` can never drift.
import { defineConnector, type PickerOption } from "./define";

/** The API version this connector and `nodes/actions/notion-create-page.ts` both speak. */
export const NOTION_VERSION = "2026-03-11";

export const NOTION_API = "https://api.notion.com/v1";

const TIMEOUT_MS = 15_000;

/** The headers every Notion call needs. Exported so the node sends exactly the same set. */
export function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

type NotionError = { message?: unknown; code?: unknown };

/**
 * One Notion call, reduced to "it worked and here is the JSON" or "it did not and here is a
 * sentence the user can act on". The token never appears in either half.
 */
async function callNotion(
  token: string,
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${NOTION_API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: notionHeaders(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not reach Notion. Check your connection and try again." };
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & NotionError;
  if (!response.ok) {
    if (response.status === 401) return { ok: false, error: "Notion rejected that integration secret." };
    const described = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
    return { ok: false, error: `Notion refused the request: ${described}` };
  }

  return { ok: true, data: payload };
}

/** Notion titles are rich text: an array of runs, each carrying its own flattened `plain_text`. */
function plainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((run) => (run as { plain_text?: unknown })?.plain_text)
    .filter((text): text is string => typeof text === "string")
    .join("")
    .trim();
}

/**
 * The property types Notion derives rather than stores. Sending any of them in `properties` on
 * `POST /v1/pages` is a 400 — a `formula` is its expression's answer, `created_time` is Notion's
 * clock — so none of them belongs in the "which column?" dropdown
 * (https://developers.notion.com/reference/property-object).
 */
const READ_ONLY_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  "created_by",
  "created_time",
  "formula",
  "last_edited_by",
  "last_edited_time",
  "rollup",
  "unique_id",
]);

/**
 * The three enum-like property types, whose config object holds the values the column accepts.
 * `select.options[]`, `multi_select.options[]` and `status.options[]` are the same `{ id, name,
 * color }` shape; only `name` is ever sent back, and only `status` also carries `groups`, which a
 * dropdown has no use for.
 */
const CHOICE_PROPERTY_TYPES: readonly string[] = ["select", "multi_select", "status"];

function choicesOf(property: Record<string, unknown>, type: string): string[] | undefined {
  if (!CHOICE_PROPERTY_TYPES.includes(type)) return undefined;

  const config = property[type];
  if (typeof config !== "object" || config === null) return undefined;

  const options = (config as { options?: unknown }).options;
  if (!Array.isArray(options)) return undefined;

  const names = options
    .map((option) => (option as { name?: unknown })?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  return names.length > 0 ? names : undefined;
}

/**
 * The columns of a data source a page can actually be created with, as picker options.
 *
 * The value is the property *name*: `notion.createPage` posts `properties: { "<name>": … }`, which
 * is what `POST /v1/pages` and the schema itself are keyed by. `property.name` is preferred over
 * the map key only as belt and braces — the docs key the map by name and the two agree — so that a
 * response keyed by id would still yield names the pages endpoint accepts.
 *
 * `title` is excluded along with the read-only types, though for the opposite reason: the node
 * writes the title from its own Title field last and drops any property row that names the title
 * column, so offering it here would be offering a value that is silently thrown away.
 */
function writableProperties(schema: Record<string, unknown>): PickerOption[] {
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) return [];

  const options: PickerOption[] = [];
  for (const [key, entry] of Object.entries(properties as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const property = entry as Record<string, unknown>;

    const type = typeof property.type === "string" ? property.type : "";
    if (!type || type === "title" || READ_ONLY_PROPERTY_TYPES.has(type)) continue;

    const name = typeof property.name === "string" && property.name ? property.name : key;
    if (!name) continue;

    const choices = choicesOf(property, type);
    options.push({ id: name, label: name, type, ...(choices ? { choices } : {}) });
  }

  return options;
}

export const notionConnector = defineConnector({
  provider: "notion",
  name: "Notion",
  category: "data",
  kind: "apiKey",
  requiresFeature: "pro_connectors",
  fields: [
    {
      name: "apiKey",
      label: "Internal integration secret",
      kind: "secret",
      placeholder: "ntn_…",
      help: "From your Notion integration, then share a database with it",
    },
  ],
  docsUrl: "https://app.notion.com/developers/connections",
  icon: "FileText",

  async test(secret) {
    const token = secret.apiKey?.trim();
    if (!token) return { ok: false, error: "Paste the internal integration secret (ntn_…)." };

    const result = await callNotion(token, "/users/me");
    if (!result.ok) return result;

    const bot = (result.data.bot ?? {}) as { workspace_name?: unknown };
    const workspaceName = typeof bot.workspace_name === "string" ? bot.workspace_name : undefined;
    const botName = typeof result.data.name === "string" ? result.data.name : "";
    const label = workspaceName || botName || "workspace";

    return {
      ok: true,
      label: `Notion (${label})`,
      hint: token.slice(-4),
      meta: {
        bot_id: result.data.id,
        ...(workspaceName ? { workspace_name: workspaceName } : {}),
      },
    };
  },

  /**
   * The data sources the integration can actually write to — search only ever returns what the
   * user shared with it, so an empty list is the honest "you have not shared a database yet".
   * `"database"` is not an allowed filter value since data sources arrived in 2025-09-03.
   *
   * `properties:<dataSourceId>` is the level below: one data source's own columns, for the
   * Properties editor's key column. The id comes from the kind because the pick route forwards a
   * single string, exactly like Airtable's `tables:<baseId>`.
   */
  async pick(kind, secret) {
    if (kind.startsWith("properties:")) {
      const dataSourceId = kind.slice("properties:".length);
      if (!dataSourceId) return [];

      const schema = await callNotion(
        secret.apiKey?.trim() ?? "",
        `/data_sources/${encodeURIComponent(dataSourceId)}`,
      );
      if (!schema.ok) throw new Error(schema.error);
      return writableProperties(schema.data);
    }

    if (kind !== "dataSources") return [];

    const result = await callNotion(secret.apiKey?.trim() ?? "", "/search", {
      filter: { property: "object", value: "data_source" },
      page_size: 100,
    });
    if (!result.ok) throw new Error(result.error);

    const results = Array.isArray(result.data.results) ? result.data.results : [];
    return results
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        id: String(entry.id),
        label: plainText(entry.title) || "Untitled",
      }));
  },
});
