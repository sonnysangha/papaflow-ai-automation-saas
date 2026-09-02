// A Notion internal integration secret (`ntn_…`) is pasted, not granted: the user creates the
// connection at https://app.notion.com/developers/connections and shares the databases it may
// touch. `GET /v1/users/me` both proves the token and names the workspace it belongs to.
//
// Every REST call carries `Notion-Version: 2026-03-11` — the header "must be included in all REST
// API requests" and the value is the current one (docs/research/connectors-data.md). The version
// lives here rather than in the node so the connector and `notion.createPage` can never drift.
import { defineConnector } from "./define";

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

export const notionConnector = defineConnector({
  provider: "notion",
  name: "Notion",
  category: "data",
  kind: "apiKey",
  requiresFeature: null,
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
   */
  async pick(kind, secret) {
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
