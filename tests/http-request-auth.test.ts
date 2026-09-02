import { afterEach, describe, expect, it, vi } from "vitest";

import { httpRequest } from "@/nodes/actions/http-request";
import { ConnectorError, type RunContext } from "@/nodes/define";

/**
 * The HTTP node's optional connection (Phase 6).
 *
 * `credential: "any"` means the node accepts whatever single token a connection holds, so these
 * tests are mostly about two things: the token reaching the right header, and the token reaching
 * nothing else — not the output, not an error message, not a step row (CLAUDE.md rule 1).
 */

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

const TOKEN = "sk-live-super-secret";

function ctx<I>(inputs: I, credential?: Record<string, unknown>): RunContext<I> {
  return { inputs, credential, orgId: "org_test", executionId: "exec_test", nodeId: "node_test" };
}

function mockFetch(impl: (...args: FetchArgs) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function ok() {
  return mockFetch(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the node run to reject");
    },
    (error: unknown) => error,
  );
}

/** A connection as `runNode`'s `openCredential` builds it: `{ provider, kind, ...secret }`. */
function connection(
  provider: string,
  kind: string,
  secret: Record<string, unknown>,
): Record<string, unknown> {
  return { provider, kind, ...secret };
}

function inputs(overrides: Record<string, unknown> = {}) {
  return httpRequest.inputs.parse({
    url: "https://api.example.com/things",
    connectionId: "conn_1",
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("http.request authentication", () => {
  it("takes any single-token connection, and takes none at all", () => {
    expect(httpRequest.credential).toBe("any");
    expect(httpRequest.credentialOptional).toBe(true);

    const defaults = httpRequest.inputs.parse({ url: "https://api.example.com/things" });
    expect(defaults.connectionId).toBeUndefined();
    expect(defaults.auth).toBe("bearer");
    expect(defaults.authHeader).toBe("Authorization");
  });

  it("sends an API key as a bearer token", async () => {
    const fetchMock = ok();

    await httpRequest.run(
      ctx(inputs(), connection("openai", "apiKey", { apiKey: TOKEN })),
    );

    expect(headersOf(fetchMock.mock.calls[0][1]).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("sends the token in a named header when auth is header", async () => {
    const fetchMock = ok();

    await httpRequest.run(
      ctx(
        inputs({ auth: "header", authHeader: "X-API-Key" }),
        connection("openai", "apiKey", { apiKey: TOKEN }),
      ),
    );

    const headers = headersOf(fetchMock.mock.calls[0][1]);
    // The raw secret is the header value here — no scheme prefix, which is what these APIs want.
    expect(headers["X-API-Key"]).toBe(TOKEN);
    expect(headers.Authorization).toBeUndefined();
  });

  it("injects nothing when auth is none, even with a connection chosen", async () => {
    const fetchMock = ok();

    await httpRequest.run(
      ctx(
        inputs({ auth: "none", headers: { "x-api-key": "typed-by-hand" } }),
        connection("openai", "apiKey", { apiKey: TOKEN }),
      ),
    );

    const headers = headersOf(fetchMock.mock.calls[0][1]);
    expect(headers).toEqual({ "x-api-key": "typed-by-hand" });
  });

  it("behaves exactly as before when no connection was chosen", async () => {
    const fetchMock = ok();

    const out = await httpRequest.run(
      ctx(
        httpRequest.inputs.parse({
          url: "https://api.example.com/things",
          headers: { "x-api-key": "abc" },
        }),
      ),
    );

    expect(out.status).toBe(200);
    // `auth` defaults to "bearer", but without a credential there is nothing to send.
    expect(headersOf(fetchMock.mock.calls[0][1])).toEqual({ "x-api-key": "abc" });
  });

  it("reads the token field the connector actually uses", async () => {
    const fetchMock = ok();

    // GitHub calls its secret `token`, Slack calls its `botToken` and stores an optional
    // `signingSecret` beside it: the connector definition is what says which one is the credential.
    await httpRequest.run(
      ctx(inputs(), connection("github", "apiKey", { token: TOKEN, repo: "acme/site" })),
    );
    expect(headersOf(fetchMock.mock.calls[0][1]).Authorization).toBe(`Bearer ${TOKEN}`);

    await httpRequest.run(
      ctx(
        inputs(),
        connection("slack", "botToken", { botToken: TOKEN, signingSecret: "not-the-token" }),
      ),
    );
    expect(headersOf(fetchMock.mock.calls[1][1]).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("replaces a hand-typed header of the same name instead of sending both", async () => {
    const fetchMock = ok();

    await httpRequest.run(
      ctx(
        inputs({ headers: { authorization: "Bearer stale" } }),
        connection("openai", "apiKey", { apiKey: TOKEN }),
      ),
    );

    const headers = headersOf(fetchMock.mock.calls[0][1]);
    expect(headers.authorization).toBeUndefined();
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("keeps the token out of the output", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req_1" },
        }),
    );

    const out = await httpRequest.run(
      ctx(inputs(), connection("openai", "apiKey", { apiKey: TOKEN })),
    );

    // `headers` is the *response*'s, so the request's Authorization header cannot appear.
    expect(out.headers["x-request-id"]).toBe("req_1");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("keeps the token out of the error a refused request throws", async () => {
    mockFetch(
      async () =>
        new Response("401 unauthorized: bad credentials", {
          status: 401,
          headers: { "content-type": "text/plain" },
        }),
    );

    const error = await caught(
      httpRequest.run(ctx(inputs(), connection("openai", "apiKey", { apiKey: TOKEN }))),
    );

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).status).toBe(401);
    expect((error as ConnectorError).message).not.toContain(TOKEN);
    expect(String((error as ConnectorError).stack)).not.toContain(TOKEN);
  });

  it("refuses a connection whose kind is not a token, without calling anything", async () => {
    const fetchMock = ok();

    for (const credential of [
      connection("stripe", "signingSecret", { signingSecret: TOKEN }),
      connection("discord-webhook", "webhookUrl", { webhookUrl: `https://x/${TOKEN}` }),
    ]) {
      const error = await caught(httpRequest.run(ctx(inputs(), credential)));

      expect(error).toBeInstanceOf(ConnectorError);
      // A 4xx, so `runNode` raises a FatalError: no retry can turn a webhook URL into a token.
      const { status, message } = error as ConnectorError;
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
      expect(message).not.toContain(TOKEN);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a token connection whose secret is missing", async () => {
    const fetchMock = ok();

    const error = await caught(
      httpRequest.run(ctx(inputs(), connection("openai", "apiKey", { apiKey: "" }))),
    );

    expect((error as ConnectorError).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to guess when auth is header and the header has no name", async () => {
    const fetchMock = ok();

    const error = await caught(
      httpRequest.run(
        ctx(
          inputs({ auth: "header", authHeader: "  " }),
          connection("openai", "apiKey", { apiKey: TOKEN }),
        ),
      ),
    );

    expect((error as ConnectorError).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
