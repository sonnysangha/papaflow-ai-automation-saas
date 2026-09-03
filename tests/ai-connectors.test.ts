import { afterEach, describe, expect, it, vi } from "vitest";

import { anthropicConnector } from "@/connectors/anthropic";
import { normalizeFieldValue, normalizeSecretInput } from "@/connectors/define";
import { googleConnector } from "@/connectors/google";
import { openaiConnector } from "@/connectors/openai";
import { CONNECTORS, connectorCatalogue } from "@/connectors/registry";
import { providerErrorDetail } from "@/lib/ai/validate";

/**
 * The "I can't seem to add any keys" path: what happens between a pasted credential and a
 * connector's verdict.
 *
 * Two failures live here. A key pasted with the newline a console copy drags along was sent
 * verbatim and every provider answered 401; and a 401 was reported as `HTTP 401`, which cannot
 * tell a typo from an Admin key from a key for the wrong provider. Nothing here touches the
 * network — the one call each test allows is stubbed and asserted.
 */

const ANTHROPIC_MODELS = "https://api.anthropic.com/v1/models?limit=1000";
const OPENAI_MODELS = "https://api.openai.com/v1/models";
const GOOGLE_MODELS = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";

const KEY = "sk-ant-api03-realkeymaterial1234";

type Route = { status?: number; body?: unknown; text?: string };
type Call = { url: string; headers: Record<string, string> };

function stubFetch(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, headers: { ...(init.headers as Record<string, string> | undefined) } });
      const route = routes[url];
      if (!route) throw new Error(`unstubbed request: ${url}`);
      const body = route.text ?? JSON.stringify(route.body ?? {});
      return new Response(body, {
        status: route.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeFieldValue", () => {
  it("drops the whitespace a paste drags in", () => {
    expect(normalizeFieldValue(`  ${KEY}\n`)).toBe(KEY);
    expect(normalizeFieldValue(`${KEY}\r\n`)).toBe(KEY);
    expect(normalizeFieldValue(`\t${KEY} `)).toBe(KEY);
    // A copy out of a rendered web page: non-breaking space and a byte-order mark.
    expect(normalizeFieldValue(` ${KEY}﻿`)).toBe(KEY);
  });

  it("strips the quotation marks around a value copied out of a shell or .env file", () => {
    expect(normalizeFieldValue(`"${KEY}"`)).toBe(KEY);
    expect(normalizeFieldValue(`'${KEY}'`)).toBe(KEY);
    expect(normalizeFieldValue("`" + KEY + "`")).toBe(KEY);
    expect(normalizeFieldValue(` "  ${KEY}  " `)).toBe(KEY);
  });

  it("leaves an unmatched quote alone rather than guessing", () => {
    expect(normalizeFieldValue(`"${KEY}`)).toBe(`"${KEY}`);
    expect(normalizeFieldValue(`${KEY}"`)).toBe(`${KEY}"`);
    expect(normalizeFieldValue('"')).toBe('"');
    expect(normalizeFieldValue("")).toBe("");
  });
});

describe("normalizeSecretInput", () => {
  it("cleans every typed field the connector declares", () => {
    expect(normalizeSecretInput(anthropicConnector, { apiKey: `  ${KEY}\n` })).toEqual({
      apiKey: KEY,
    });
  });

  it("passes through values the connector never declared, byte for byte", () => {
    // A provider-issued value merged in by `afterCreate` is not something to tidy up.
    const cleaned = normalizeSecretInput(anthropicConnector, {
      apiKey: ` ${KEY} `,
      refreshToken: "  keep me exactly  ",
    });

    expect(cleaned).toEqual({ apiKey: KEY, refreshToken: "  keep me exactly  " });
  });
});

describe("providerErrorDetail", () => {
  it("reads the shape Anthropic, OpenAI, Google, Groq, DeepSeek and OpenRouter answer with", () => {
    expect(
      providerErrorDetail(
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}',
      ),
    ).toBe("invalid x-api-key");

    expect(
      providerErrorDetail('{"error":{"message":"Incorrect API key provided: sk-xxx","code":"invalid_api_key"}}'),
    ).toBe("Incorrect API key provided: sk-xxx");
  });

  it("reads the flatter shapes too", () => {
    expect(providerErrorDetail('{"error":"invalid api key"}')).toBe("invalid api key");
    expect(providerErrorDetail('{"message":"Unauthorized"}')).toBe("Unauthorized");
    expect(providerErrorDetail('{"detail":"Invalid API key"}')).toBe("Invalid API key");
    expect(providerErrorDetail('{"detail":{"status":"invalid_api_key","message":"bad key"}}')).toBe(
      "bad key",
    );
  });

  it("answers null for a body with nothing to say", () => {
    expect(providerErrorDetail("")).toBeNull();
    expect(providerErrorDetail("   ")).toBeNull();
    expect(providerErrorDetail("{}")).toBeNull();
    // An HTML error page from a proxy is noise, not an explanation.
    expect(providerErrorDetail("<html><body>502 Bad Gateway</body></html>")).toBeNull();
  });

  it("truncates a body that runs on", () => {
    const detail = providerErrorDetail(JSON.stringify({ error: { message: "x".repeat(500) } }));
    expect(detail).toHaveLength(200);
    expect(detail?.endsWith("…")).toBe(true);
  });
});

describe("AI connector test()", () => {
  it("sends Anthropic the documented request and captures its model ids", async () => {
    const calls = stubFetch({
      [ANTHROPIC_MODELS]: { body: { data: [{ id: "claude-opus-5" }, { id: "claude-haiku-4-5" }] } },
    });

    const result = await anthropicConnector.test({ apiKey: KEY });

    expect(calls).toHaveLength(1);
    // GET /v1/models with x-api-key + anthropic-version, `limit` at its documented maximum (1–1000).
    expect(calls[0].url).toBe(ANTHROPIC_MODELS);
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.models).toEqual(["claude-opus-5", "claude-haiku-4-5"]);
    expect(result.hint).toBe(KEY.slice(-4));
  });

  it("carries Anthropic's own words into the rejection", async () => {
    stubFetch({
      [ANTHROPIC_MODELS]: {
        status: 401,
        text: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}',
      },
    });

    const result = await anthropicConnector.test({ apiKey: KEY });

    expect(result).toEqual({
      ok: false,
      error: "Anthropic rejected the key (401: invalid x-api-key)",
    });
  });

  it("falls back to the bare status when the provider explained nothing", async () => {
    stubFetch({ [OPENAI_MODELS]: { status: 503, text: "" } });

    const result = await openaiConnector.test({ apiKey: "sk-proj-abcdefghijklmnop" });

    expect(result).toEqual({ ok: false, error: "OpenAI rejected the key (HTTP 503)" });
  });

  it("never echoes the key back, even when the provider does", async () => {
    // A Google-shaped key: `lib/ai/key-shape.ts` refuses an `sk-…` one for Google before the
    // request is made, which is a different (and also correct) message.
    const googleKey = "AIzaSyRealKeyMaterial1234";
    stubFetch({
      [GOOGLE_MODELS]: {
        status: 400,
        text: JSON.stringify({
          error: { message: `API key not valid: ${googleKey}. Please pass a valid API key.` },
        }),
      },
    });

    const result = await googleConnector.test({ apiKey: googleKey });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain(googleKey);
    expect(result.error).toBe(
      "Google Gemini rejected the key (400: API key not valid: ••••. Please pass a valid API key.)",
    );
  });

  it("refuses an empty key without asking the provider", async () => {
    stubFetch({});

    expect(await anthropicConnector.test({ apiKey: "   " })).toEqual({
      ok: false,
      error: "Anthropic needs an API key",
    });
  });
});

describe("AI connector fields", () => {
  it("names the right kind of key under every AI provider's API key field", () => {
    const ai = connectorCatalogue([]).filter((entry) => entry.category === "ai");
    expect(ai.length).toBeGreaterThan(0);

    for (const entry of ai) {
      const field = CONNECTORS[entry.provider].fields.find((one) => one.name === "apiKey");
      expect(field, `${entry.provider} has an apiKey field`).toBeDefined();
      expect(field?.help, `${entry.provider} explains where its key comes from`).toBeTruthy();
    }
  });

  it("tells an Anthropic user which of their three key types this is", () => {
    const field = anthropicConnector.fields.find((one) => one.name === "apiKey");
    expect(field?.help).toContain("console.anthropic.com");
    expect(field?.help).toContain("sk-ant-api03-");
    expect(field?.help).toContain("Admin keys");
  });
});
