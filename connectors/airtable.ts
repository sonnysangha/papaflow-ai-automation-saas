// Airtable personal access tokens (`pat…`) are scoped per user: `GET /v0/meta/whoami` is the one
// call that works with any of them, so it is the test. The pickers then use the metadata API,
// which needs `schema.bases:read` — a PAT without it passes the test and fails the picker, which
// is exactly the distinction the user needs to see (docs/research/connectors-data.md).
import { defineConnector } from "./define";

export const AIRTABLE_API = "https://api.airtable.com/v0";

const TIMEOUT_MS = 15_000;

type AirtableError = { error?: unknown };

/** `{ error: "NOT_FOUND" }` or `{ error: { type, message } }` — both shapes appear. */
function describeError(payload: AirtableError, status: number): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown; type?: unknown }).message;
    const type = (error as { type?: unknown }).type;
    if (typeof message === "string") return message;
    if (typeof type === "string") return type;
  }
  return `HTTP ${status}`;
}

async function callAirtable(
  token: string,
  path: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${AIRTABLE_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not reach Airtable. Check your connection and try again." };
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & AirtableError;
  if (!response.ok) {
    if (response.status === 401) return { ok: false, error: "Airtable rejected that personal access token." };
    if (response.status === 403) {
      return {
        ok: false,
        error: "That token is missing a scope. It needs data.records:write and schema.bases:read.",
      };
    }
    return { ok: false, error: `Airtable refused the request: ${describeError(payload, response.status)}` };
  }

  return { ok: true, data: payload };
}

/** `{ bases: […] }` and `{ tables: […] }` are the same shape twice; this reads either. */
function namedList(data: Record<string, unknown>, key: string): { id: string; label: string }[] {
  const rows = data[key];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      id: String(row.id),
      label: typeof row.name === "string" && row.name ? row.name : String(row.id),
    }));
}

export const airtableConnector = defineConnector({
  provider: "airtable",
  name: "Airtable",
  category: "data",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "Personal access token",
      kind: "secret",
      placeholder: "pat…",
      help: "Scopes: data.records:write and schema.bases:read",
    },
  ],
  docsUrl: "https://airtable.com/create/tokens",
  icon: "Table",

  async test(secret) {
    const token = secret.apiKey?.trim();
    if (!token) return { ok: false, error: "Paste the personal access token (pat…) from Airtable." };

    const result = await callAirtable(token, "/meta/whoami");
    if (!result.ok) return result;

    const email = typeof result.data.email === "string" ? result.data.email : "";
    const userId = typeof result.data.id === "string" ? result.data.id : "";
    if (!userId) return { ok: false, error: "Airtable accepted the token but returned no user id." };

    return {
      ok: true,
      label: `Airtable (${email || userId})`,
      hint: token.slice(-4),
      meta: {
        user_id: userId,
        ...(email ? { email } : {}),
        ...(Array.isArray(result.data.scopes) ? { scopes: result.data.scopes } : {}),
      },
    };
  },

  /**
   * `bases` fills the base dropdown; `tables:<baseId>` fills the table dropdown underneath it —
   * the base has to be chosen first, which is why the kind carries it rather than a second
   * argument (the pick route only ever forwards one string).
   */
  async pick(kind, secret) {
    const token = secret.apiKey?.trim() ?? "";

    if (kind === "bases") {
      const result = await callAirtable(token, "/meta/bases");
      if (!result.ok) throw new Error(result.error);
      return namedList(result.data, "bases");
    }

    if (kind.startsWith("tables:")) {
      const baseId = kind.slice("tables:".length);
      if (!baseId) return [];
      const result = await callAirtable(token, `/meta/bases/${encodeURIComponent(baseId)}/tables`);
      if (!result.ok) throw new Error(result.error);
      return namedList(result.data, "tables");
    }

    return [];
  },
});
