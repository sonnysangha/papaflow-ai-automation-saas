// Linear is GraphQL only, and a personal API key goes in `Authorization` **bare** — no `Bearer`
// prefix, which is reserved for OAuth access tokens (docs/research/connectors-data.md, confirmed
// against @linear/sdk's own client). Sending `Bearer <key>` is a silent 401.
//
// Linear also does not use 429: a throttled request comes back as HTTP 400 with
// `errors[].extensions.code === "RATELIMITED"`, which `nodes/actions/linear-create-issue.ts` maps
// onto the retryable branch by hand.
import { defineConnector } from "./define";

export const LINEAR_API = "https://api.linear.app/graphql";

const TIMEOUT_MS = 15_000;

/** The bare-key headers. Exported so the node cannot accidentally send `Bearer`. */
export function linearHeaders(apiKey: string): Record<string, string> {
  return { Authorization: apiKey, "Content-Type": "application/json" };
}

type GraphQLResponse = { data?: Record<string, unknown>; errors?: { message?: unknown }[] };

async function callLinear(
  apiKey: string,
  query: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(LINEAR_API, {
      method: "POST",
      headers: linearHeaders(apiKey),
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not reach Linear. Check your connection and try again." };
  }

  const payload = (await response.json().catch(() => ({}))) as GraphQLResponse;

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "Linear rejected that API key." };
  }

  const firstError = payload.errors?.[0];
  if (firstError) {
    const message = typeof firstError.message === "string" ? firstError.message : "unknown error";
    return { ok: false, error: `Linear refused the request: ${message}` };
  }

  if (!response.ok || !payload.data) {
    return { ok: false, error: `Linear refused the request: HTTP ${response.status}` };
  }

  return { ok: true, data: payload.data };
}

export const linearConnector = defineConnector({
  provider: "linear",
  name: "Linear",
  category: "data",
  kind: "apiKey",
  requiresFeature: "pro_connectors",
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "lin_api_…",
      help: "Linear → Settings → Security & access → Personal API keys",
    },
  ],
  docsUrl: "https://linear.app/settings/account/security",
  icon: "SquareKanban",

  async test(secret) {
    const apiKey = secret.apiKey?.trim();
    if (!apiKey) return { ok: false, error: "Paste a Linear personal API key." };

    const result = await callLinear(apiKey, "{ viewer { id name } }");
    if (!result.ok) return result;

    const viewer = (result.data.viewer ?? {}) as { id?: unknown; name?: unknown };
    const name = typeof viewer.name === "string" ? viewer.name : "";
    if (typeof viewer.id !== "string") {
      return { ok: false, error: "Linear accepted the key but returned no viewer." };
    }

    return {
      ok: true,
      label: `Linear (${name || viewer.id})`,
      hint: apiKey.slice(-4),
      meta: { user_id: viewer.id, ...(name ? { name } : {}) },
    };
  },

  /** The teams the key can file issues into — `teamId` is required by `issueCreate`. */
  async pick(kind, secret) {
    if (kind !== "teams") return [];

    const result = await callLinear(secret.apiKey?.trim() ?? "", "{ teams { nodes { id name key } } }");
    if (!result.ok) throw new Error(result.error);

    const teams = (result.data.teams ?? {}) as { nodes?: unknown };
    const nodes = Array.isArray(teams.nodes) ? teams.nodes : [];
    return nodes
      .filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null)
      .map((node) => {
        const name = typeof node.name === "string" ? node.name : String(node.id);
        const key = typeof node.key === "string" ? node.key : "";
        return { id: String(node.id), label: key ? `${name} (${key})` : name };
      });
  },
});
