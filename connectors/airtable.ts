// Airtable personal access tokens (`pat…`) are scoped per user: `GET /v0/meta/whoami` is the one
// call that works with any of them, so it is the test. The pickers then use the metadata API,
// which needs `schema.bases:read` — a PAT without it passes the test and fails the picker, which
// is exactly the distinction the user needs to see (docs/research/connectors-data.md).
import { defineConnector, type PickerOption } from "./define";

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

/**
 * The field types Airtable computes for itself. Every one of them refuses a write — a `formula`
 * column is the formula's answer, an `autoNumber` is Airtable's counter — so offering them in the
 * "which column?" dropdown could only ever produce a 422 the user cannot fix
 * (https://airtable.com/developers/web/api/field-model). Everything else is writable, including
 * the ones the create-record node's `typecast: true` coerces a string into.
 */
const COMPUTED_FIELD_TYPES: ReadonlySet<string> = new Set([
  "aiText",
  "autoNumber",
  "button",
  "count",
  "createdBy",
  "createdTime",
  "externalSyncSource",
  "formula",
  "lastModifiedBy",
  "lastModifiedTime",
  // Airtable names the lookup type `multipleLookupValues`; `lookup` is the older spelling, and a
  // base that still answers with it must be filtered too.
  "lookup",
  "multipleLookupValues",
  "rollup",
]);

/** `options.choices[].name` for a `singleSelect`/`multipleSelects` field, or nothing for the rest. */
function choicesOf(field: Record<string, unknown>): string[] | undefined {
  const options = field.options;
  if (typeof options !== "object" || options === null) return undefined;

  const choices = (options as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;

  const names = choices
    .map((choice) => (choice as { name?: unknown })?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  return names.length > 0 ? names : undefined;
}

/**
 * The writable columns of one table in a base schema, as picker options.
 *
 * The value is the field *name*, not its id: `airtable.createRecord` posts `fields: { "<name>": … }`
 * and that is what the user sees in the grid. The table is matched on its id or its name for the
 * same reason — the table picker stores ids, but a hand-typed `Leads` is equally valid in the
 * records URL, and a field list that came back empty for it would look like a permissions problem.
 */
function writableFields(data: Record<string, unknown>, tableId: string): PickerOption[] {
  const tables = Array.isArray(data.tables) ? data.tables : [];
  const table = tables
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .find((entry) => entry.id === tableId || entry.name === tableId);

  const fields = Array.isArray(table?.fields) ? table.fields : [];
  const options: PickerOption[] = [];

  for (const entry of fields) {
    if (typeof entry !== "object" || entry === null) continue;
    const field = entry as Record<string, unknown>;

    const name = typeof field.name === "string" ? field.name : "";
    const type = typeof field.type === "string" ? field.type : "";
    if (!name || COMPUTED_FIELD_TYPES.has(type)) continue;

    const choices = choicesOf(field);
    options.push({ id: name, label: name, ...(type ? { type } : {}), ...(choices ? { choices } : {}) });
  }

  return options;
}

export const airtableConnector = defineConnector({
  provider: "airtable",
  name: "Airtable",
  category: "data",
  kind: "apiKey",
  requiresFeature: "pro_connectors",
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
   * argument (the pick route only ever forwards one string). `fields:<baseId>:<tableId>` is the
   * same idea one level down: the column names of one table, for the Fields editor's key column.
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

    if (kind.startsWith("fields:")) {
      // `<baseId>:<tableId>` — neither id nor a table name may contain a colon, so anything else
      // is a kind this connector did not write and is answered with nothing rather than a guess.
      const parts = kind.slice("fields:".length).split(":");
      if (parts.length !== 2) return [];
      const [baseId, tableId] = parts;
      if (!baseId || !tableId) return [];

      // The one metadata call there is: the whole base's schema, tables and fields together.
      const result = await callAirtable(token, `/meta/bases/${encodeURIComponent(baseId)}/tables`);
      if (!result.ok) throw new Error(result.error);
      return writableFields(result.data, tableId);
    }

    return [];
  },
});
