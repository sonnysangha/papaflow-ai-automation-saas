// Validate a user's AI provider key and discover the models it may actually call, using the
// endpoint table verified in `docs/research/ai-sdk.md`. Model ids are never hardcoded in the
// UI (CLAUDE.md rule 11): the picker reads `connection.meta.models` captured here.
//
// The key is only ever sent to the provider it belongs to, and only the last four characters
// of it ever come back out (`hint`).
import type { ConnectorTestResult } from "@/connectors/define";

const USER_AGENT = "papaflow/0.1";
const TIMEOUT_MS = 15_000;

/** Display names, shared by the connector files' `name` and by every message below. */
export const AI_PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  xai: "xAI",
  mistral: "Mistral",
  groq: "Groq",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  elevenlabs: "ElevenLabs",
  fal: "fal.ai",
};

type Json = Record<string, unknown>;

/** A non-2xx answer: the provider looked at the key and said no (or fell over). */
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

/** A 200 answer that still means "you cannot use this key" — xAI's blocked flags. */
class KeyRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRejected";
  }
}

async function request(
  url: string,
  options: { headers: Record<string, string>; method?: string; body?: string },
): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: { "User-Agent": USER_AGENT, ...options.headers },
    ...(options.body === undefined ? {} : { body: options.body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new HttpError(response.status);
  return response.json().catch(() => ({}));
}

const bearer = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });

/** Rows of a list response, whether it arrives bare or wrapped in `{ data }` / `{ models }`. */
function rows(value: unknown): Json[] {
  return Array.isArray(value) ? (value.filter((row) => typeof row === "object" && row !== null) as Json[]) : [];
}

function ids(entries: Json[], key = "id"): string[] {
  return entries.map((entry) => entry[key]).filter((id): id is string => typeof id === "string" && id.length > 0);
}

type Discovery = { models: string[]; meta?: Json };

const DISCOVERERS: Record<string, (apiKey: string) => Promise<Discovery>> = {
  async openai(apiKey) {
    const body = (await request("https://api.openai.com/v1/models", { headers: bearer(apiKey) })) as Json;
    return { models: ids(rows(body.data)) };
  },

  async anthropic(apiKey) {
    const body = (await request("https://api.anthropic.com/v1/models?limit=1000", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    })) as Json;
    return { models: ids(rows(body.data)) };
  },

  async google(apiKey) {
    const body = (await request("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": apiKey },
    })) as Json;
    const models = rows(body.models)
      .filter((model) => supportsGenerateContent(model))
      .map((model) => (typeof model.name === "string" ? model.name.replace(/^models\//, "") : ""))
      .filter((id) => id.length > 0);
    return { models };
  },

  async xai(apiKey) {
    const key = (await request("https://api.x.ai/v1/api-key", { headers: bearer(apiKey) })) as Json;
    if (key.api_key_blocked || key.api_key_disabled || key.team_blocked) {
      throw new KeyRejected("xAI reports this key as blocked or disabled");
    }
    const body = (await request("https://api.x.ai/v1/language-models", { headers: bearer(apiKey) })) as Json;
    return { models: ids(rows(body.models)) };
  },

  async mistral(apiKey) {
    const body = (await request("https://api.mistral.ai/v1/models", { headers: bearer(apiKey) })) as Json;
    const chat = rows(body.data).filter((model) => Boolean((model.capabilities as Json | undefined)?.completion_chat));
    return { models: ids(chat) };
  },

  async groq(apiKey) {
    const body = (await request("https://api.groq.com/openai/v1/models", { headers: bearer(apiKey) })) as Json;
    return { models: ids(rows(body.data)) };
  },

  async deepseek(apiKey) {
    const body = (await request("https://api.deepseek.com/models", { headers: bearer(apiKey) })) as Json;
    return { models: ids(rows(body.data)) };
  },

  async openrouter(apiKey) {
    const key = (await request("https://openrouter.ai/api/v1/key", { headers: bearer(apiKey) })) as Json;
    const list = (await request("https://openrouter.ai/api/v1/models", { headers: bearer(apiKey) })) as Json;
    const limitRemaining = (key.data as Json | undefined)?.limit_remaining;
    return {
      models: ids(rows(list.data)),
      ...(typeof limitRemaining === "number" ? { meta: { limitRemaining } } : {}),
    };
  },

  async elevenlabs(apiKey) {
    const headers = { "xi-api-key": apiKey };
    await request("https://api.elevenlabs.io/v1/user", { headers });
    const list = await request("https://api.elevenlabs.io/v1/models", { headers });
    const speech = rows(list).filter((model) => Boolean(model.can_do_text_to_speech));
    return { models: ids(speech, "model_id") };
  },

  async fal(apiKey) {
    const headers = { Authorization: `Key ${apiKey}` };
    // fal has no list endpoint that authenticates, so the cheapest documented run is the test.
    await request("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", image_size: "square", num_images: 1 }),
    });
    try {
      const body = (await request("https://api.fal.ai/v1/models?status=active&limit=50", { headers })) as Json;
      return { models: ids(rows(body.models), "endpoint_id") };
    } catch {
      // Auth is optional on the catalogue and it is only used to fill a picker: a failure
      // there must not cost the user a valid key.
      return { models: [] };
    }
  },
};

function supportsGenerateContent(model: Json): boolean {
  const methods = model.supportedGenerationMethods;
  return Array.isArray(methods) && methods.includes("generateContent");
}

/**
 * Tests an AI provider key and captures its model list. Returns the connector test shape —
 * `meta.models` is what the model picker reads, `meta.fetchedAt` is when it was captured.
 */
export async function validateAndDiscover(provider: string, apiKey: string): Promise<ConnectorTestResult> {
  const name = AI_PROVIDER_NAMES[provider];
  const discover = DISCOVERERS[provider];
  if (!name || !discover) return { ok: false, error: `Unknown AI provider: ${provider}` };
  if (!apiKey) return { ok: false, error: `${name} needs an API key` };

  const hint = apiKey.slice(-4);
  try {
    const { models, meta } = await discover(apiKey);
    return {
      ok: true,
      label: `${name} (…${hint})`,
      hint,
      meta: { models, fetchedAt: Date.now(), ...meta },
    };
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, error: `${name} rejected the key (HTTP ${error.status})` };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
