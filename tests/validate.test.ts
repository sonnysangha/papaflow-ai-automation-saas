import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectorTestResult } from "@/connectors/define";
import { validateAndDiscover } from "@/lib/ai/validate";

type Route = { status?: number; body?: unknown };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string; signal?: unknown };

/**
 * Every provider is exercised against a routing table rather than a queue, so a test fails
 * loudly when `validateAndDiscover` calls a URL the verified endpoint table does not list.
 */
function stubFetch(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: { ...(init.headers as Record<string, string> | undefined) },
        body: typeof init.body === "string" ? init.body : undefined,
        signal: init.signal,
      });
      const route = routes[url];
      if (!route) throw new Error(`unstubbed request: ${url}`);
      return new Response(JSON.stringify(route.body ?? {}), {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

function expectOk(result: ConnectorTestResult) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

function expectFailed(result: ConnectorTestResult) {
  if (result.ok) throw new Error(`expected failure, got: ${result.label}`);
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateAndDiscover", () => {
  it("validates OpenAI with a bearer key and reads data[].id", async () => {
    const calls = stubFetch({
      "https://api.openai.com/v1/models": {
        body: { object: "list", data: [{ id: "gpt-5.4" }, { id: "gpt-4o-mini" }] },
      },
    });

    const result = expectOk(await validateAndDiscover("openai", "sk-live-abcd"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/models");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer sk-live-abcd");
    expect(result.label).toBe("OpenAI (…abcd)");
    expect(result.hint).toBe("abcd");
    expect(result.meta.models).toEqual(["gpt-5.4", "gpt-4o-mini"]);
    expect(typeof result.meta.fetchedAt).toBe("number");
  });

  it("keeps only models a text-generation node can call", async () => {
    // OpenAI's list is everything the key may reach and Groq's carries Whisper and PlayAI TTS, with
    // no capability flag on either. What is captured here is what the Model dropdown offers and
    // what the Builder picks its own planning model out of — where `prefer: ["large"]` would
    // otherwise happily match `whisper-large-v3`.
    stubFetch({
      "https://api.openai.com/v1/models": {
        body: {
          data: [
            { id: "gpt-5.4" },
            { id: "text-embedding-3-small" },
            { id: "tts-1" },
            { id: "dall-e-3" },
            { id: "whisper-1" },
            { id: "omni-moderation-latest" },
            { id: "chatgpt-4o-latest" },
          ],
        },
      },
    });

    expect(expectOk(await validateAndDiscover("openai", "sk-live-abcd")).meta.models).toEqual([
      "gpt-5.4",
      "chatgpt-4o-latest",
    ]);

    vi.unstubAllGlobals();
    stubFetch({
      "https://api.groq.com/openai/v1/models": {
        body: {
          data: [
            { id: "llama-3.3-70b-versatile" },
            { id: "whisper-large-v3" },
            { id: "playai-tts" },
          ],
        },
      },
    });

    expect(expectOk(await validateAndDiscover("groq", "gsk-key-2222")).meta.models).toEqual([
      "llama-3.3-70b-versatile",
    ]);
  });

  it("validates Anthropic with x-api-key + anthropic-version and reads data[].id", async () => {
    const calls = stubFetch({
      "https://api.anthropic.com/v1/models?limit=1000": {
        body: { data: [{ id: "claude-opus-5" }, { id: "claude-sonnet-5" }], has_more: false },
      },
    });

    const result = expectOk(await validateAndDiscover("anthropic", "sk-ant-wxyz"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant-wxyz");
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(result.label).toBe("Anthropic (…wxyz)");
    expect(result.meta.models).toEqual(["claude-opus-5", "claude-sonnet-5"]);
  });

  it("validates Google with x-goog-api-key, keeps generateContent models and strips the models/ prefix", async () => {
    const calls = stubFetch({
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000": {
        body: {
          models: [
            { name: "models/gemini-3.1-pro", supportedGenerationMethods: ["generateContent", "countTokens"] },
            { name: "models/text-embedding-005", supportedGenerationMethods: ["embedContent"] },
            { name: "models/gemini-3.1-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        },
      },
    });

    const result = expectOk(await validateAndDiscover("google", "AIzaSyTest1234"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(calls[0].headers["x-goog-api-key"]).toBe("AIzaSyTest1234");
    expect(result.label).toBe("Google Gemini (…1234)");
    expect(result.meta.models).toEqual(["gemini-3.1-pro", "gemini-3.1-flash"]);
  });

  it("validates xAI through /v1/api-key then lists language models", async () => {
    const calls = stubFetch({
      "https://api.x.ai/v1/api-key": {
        body: { api_key_blocked: false, api_key_disabled: false, team_blocked: false },
      },
      "https://api.x.ai/v1/language-models": {
        body: { models: [{ id: "grok-4.6" }, { id: "grok-4-fast" }] },
      },
    });

    const result = expectOk(await validateAndDiscover("xai", "xai-key-6789"));

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.x.ai/v1/api-key",
      "https://api.x.ai/v1/language-models",
    ]);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe("Bearer xai-key-6789");
    }
    expect(result.label).toBe("xAI (…6789)");
    expect(result.meta.models).toEqual(["grok-4.6", "grok-4-fast"]);
  });

  it.each([["api_key_blocked"], ["api_key_disabled"], ["team_blocked"]])(
    "refuses an xAI key reported as %s",
    async (flag) => {
      const calls = stubFetch({
        "https://api.x.ai/v1/api-key": {
          body: { api_key_blocked: false, api_key_disabled: false, team_blocked: false, [flag]: true },
        },
      });

      const result = expectFailed(await validateAndDiscover("xai", "xai-key-6789"));

      // Never reaches the model list: the key is unusable.
      expect(calls).toHaveLength(1);
      expect(result.error).toMatch(/xAI/);
    },
  );

  it("validates Mistral and keeps only chat-completion models", async () => {
    const calls = stubFetch({
      "https://api.mistral.ai/v1/models": {
        body: {
          data: [
            { id: "mistral-large-latest", capabilities: { completion_chat: true } },
            { id: "mistral-embed", capabilities: { completion_chat: false } },
            { id: "voxtral-mini-latest", capabilities: {} },
          ],
        },
      },
    });

    const result = expectOk(await validateAndDiscover("mistral", "mistral-key-2222"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.mistral.ai/v1/models");
    expect(calls[0].headers.Authorization).toBe("Bearer mistral-key-2222");
    expect(result.label).toBe("Mistral (…2222)");
    expect(result.meta.models).toEqual(["mistral-large-latest"]);
  });

  it("validates Groq on the OpenAI-compatible models route", async () => {
    const calls = stubFetch({
      "https://api.groq.com/openai/v1/models": {
        body: { data: [{ id: "llama-3.3-70b-versatile" }, { id: "openai/gpt-oss-120b" }] },
      },
    });

    const result = expectOk(await validateAndDiscover("groq", "gsk_test_3333"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/models");
    expect(calls[0].headers.Authorization).toBe("Bearer gsk_test_3333");
    expect(result.label).toBe("Groq (…3333)");
    expect(result.meta.models).toEqual(["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]);
  });

  it("validates DeepSeek on its unversioned models route", async () => {
    const calls = stubFetch({
      "https://api.deepseek.com/models": {
        body: { data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] },
      },
    });

    const result = expectOk(await validateAndDiscover("deepseek", "sk-deepseek-4444"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/models");
    expect(calls[0].headers.Authorization).toBe("Bearer sk-deepseek-4444");
    expect(result.label).toBe("DeepSeek (…4444)");
    expect(result.meta.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
  });

  it("validates OpenRouter on /key, lists /models and keeps the remaining limit", async () => {
    const calls = stubFetch({
      "https://openrouter.ai/api/v1/key": {
        body: { data: { label: "sk-or-v1-...5555", limit: 10, limit_remaining: 7.5, is_free_tier: false } },
      },
      "https://openrouter.ai/api/v1/models": {
        body: { data: [{ id: "anthropic/claude-opus-5" }, { id: "openai/gpt-5.4" }] },
      },
    });

    const result = expectOk(await validateAndDiscover("openrouter", "sk-or-v1-5555"));

    expect(calls.map((call) => call.url)).toEqual([
      "https://openrouter.ai/api/v1/key",
      "https://openrouter.ai/api/v1/models",
    ]);
    expect(calls[0].headers.Authorization).toBe("Bearer sk-or-v1-5555");
    expect(result.label).toBe("OpenRouter (…5555)");
    expect(result.meta.models).toEqual(["anthropic/claude-opus-5", "openai/gpt-5.4"]);
    expect(result.meta.limitRemaining).toBe(7.5);
  });

  it("omits limitRemaining when OpenRouter reports an unlimited key", async () => {
    stubFetch({
      "https://openrouter.ai/api/v1/key": { body: { data: { limit: null, limit_remaining: null } } },
      "https://openrouter.ai/api/v1/models": { body: { data: [{ id: "openai/gpt-5.4" }] } },
    });

    const result = expectOk(await validateAndDiscover("openrouter", "sk-or-v1-5555"));

    expect(result.meta).not.toHaveProperty("limitRemaining");
  });

  it("validates ElevenLabs on /v1/user and keeps text-to-speech models", async () => {
    const calls = stubFetch({
      "https://api.elevenlabs.io/v1/user": {
        body: { user_id: "u_1", subscription: { tier: "creator", status: "active" } },
      },
      "https://api.elevenlabs.io/v1/models": {
        body: [
          { model_id: "eleven_v3", can_do_text_to_speech: true },
          { model_id: "scribe_v2", can_do_text_to_speech: false },
          { model_id: "eleven_flash_v2_5", can_do_text_to_speech: true },
        ],
      },
    });

    const result = expectOk(await validateAndDiscover("elevenlabs", "eleven-key-7777"));

    expect(calls.map((call) => call.url)).toEqual([
      "https://api.elevenlabs.io/v1/user",
      "https://api.elevenlabs.io/v1/models",
    ]);
    for (const call of calls) {
      expect(call.headers["xi-api-key"]).toBe("eleven-key-7777");
      expect(call.headers.Authorization).toBeUndefined();
    }
    expect(result.label).toBe("ElevenLabs (…7777)");
    expect(result.meta.models).toEqual(["eleven_v3", "eleven_flash_v2_5"]);
  });

  it("validates fal with a cheap square flux/schnell call and lists active endpoints", async () => {
    const calls = stubFetch({
      "https://fal.run/fal-ai/flux/schnell": { body: { images: [{ url: "https://fal.media/x.png" }] } },
      "https://api.fal.ai/v1/models?status=active&limit=50": {
        body: { models: [{ endpoint_id: "fal-ai/flux/dev" }, { endpoint_id: "fal-ai/qwen-image" }] },
      },
    });

    const result = expectOk(await validateAndDiscover("fal", "fal-key-8888"));

    expect(calls[0].url).toBe("https://fal.run/fal-ai/flux/schnell");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Key fal-key-8888");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ prompt: "test", image_size: "square", num_images: 1 });
    expect(calls[1].url).toBe("https://api.fal.ai/v1/models?status=active&limit=50");
    expect(result.label).toBe("fal.ai (…8888)");
    expect(result.meta.models).toEqual(["fal-ai/flux/dev", "fal-ai/qwen-image"]);
  });

  it("still accepts a fal key when the optional model catalogue fails", async () => {
    stubFetch({
      "https://fal.run/fal-ai/flux/schnell": { body: { images: [] } },
      "https://api.fal.ai/v1/models?status=active&limit=50": { status: 500 },
    });

    const result = expectOk(await validateAndDiscover("fal", "fal-key-8888"));

    expect(result.meta.models).toEqual([]);
  });

  it.each([
    ["openai", "https://api.openai.com/v1/models", "OpenAI"],
    ["anthropic", "https://api.anthropic.com/v1/models?limit=1000", "Anthropic"],
    ["google", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", "Google Gemini"],
    ["xai", "https://api.x.ai/v1/api-key", "xAI"],
    ["mistral", "https://api.mistral.ai/v1/models", "Mistral"],
    ["groq", "https://api.groq.com/openai/v1/models", "Groq"],
    ["deepseek", "https://api.deepseek.com/models", "DeepSeek"],
    ["openrouter", "https://openrouter.ai/api/v1/key", "OpenRouter"],
    ["elevenlabs", "https://api.elevenlabs.io/v1/user", "ElevenLabs"],
    ["fal", "https://fal.run/fal-ai/flux/schnell", "fal.ai"],
  ])("reports a rejected %s key in the provider's own words", async (provider, url, name) => {
    stubFetch({ [url]: { status: 401, body: { error: "invalid api key" } } });

    const result = expectFailed(await validateAndDiscover(provider, "bad-key-0000"));

    // A bare `HTTP 401` cannot tell a typo from an expired key from a key for the wrong product,
    // and the field is rendered as dots, so the provider's sentence is the only clue there is.
    expect(result.error).toBe(`${name} rejected the key (401: invalid api key)`);
  });

  it("falls back to the bare status when the provider's body explains nothing", async () => {
    stubFetch({ "https://api.openai.com/v1/models": { status: 500, body: {} } });

    const result = expectFailed(await validateAndDiscover("openai", "sk-live-abcd"));

    expect(result.error).toBe("OpenAI rejected the key (HTTP 500)");
  });

  it("sends papaflow's user agent and an abort signal on every request", async () => {
    const calls = stubFetch({
      "https://api.openai.com/v1/models": { body: { data: [{ id: "gpt-5.4" }] } },
    });

    await validateAndDiscover("openai", "sk-live-abcd");

    expect(calls[0].headers["User-Agent"]).toBe("papaflow/0.1");
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces a network error instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = expectFailed(await validateAndDiscover("openai", "sk-live-abcd"));

    expect(result.error).toBe("fetch failed");
  });

  it("refuses an unknown provider without touching the network", async () => {
    const calls = stubFetch({});

    const result = expectFailed(await validateAndDiscover("not-a-provider", "sk-live-abcd"));

    expect(calls).toHaveLength(0);
    expect(result.error).toMatch(/not-a-provider/);
  });

  it("refuses an empty key without touching the network", async () => {
    const calls = stubFetch({});

    const result = expectFailed(await validateAndDiscover("openai", ""));

    expect(calls).toHaveLength(0);
    expect(result.error).toMatch(/OpenAI/);
  });
});
