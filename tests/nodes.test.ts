import { afterEach, describe, expect, it, vi } from "vitest";
import { emailSend } from "@/nodes/actions/email-send";
import { httpRequest } from "@/nodes/actions/http-request";
import { ConnectorError, type RunContext } from "@/nodes/define";
import { manualTrigger } from "@/nodes/triggers/manual";

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function ctx<I>(inputs: I, credential?: Record<string, unknown>): RunContext<I> {
  return {
    inputs,
    credential,
    orgId: "org_test",
    executionId: "exec_test",
    nodeId: "node_test",
  };
}

function mockFetch(impl: (...args: FetchArgs) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("manual.trigger", () => {
  it("is a trigger with no credential and no feature gate", () => {
    expect(manualTrigger.type).toBe("manual.trigger");
    expect(manualTrigger.category).toBe("trigger");
    expect(manualTrigger.credential).toBeNull();
    expect(manualTrigger.requiresFeature).toBeNull();
  });

  it("returns the parsed sample payload", async () => {
    await expect(manualTrigger.run(ctx({ sample: '{"a":1}' }))).resolves.toEqual({
      payload: { a: 1 },
    });
  });

  it("falls back to an empty payload for invalid JSON", async () => {
    await expect(manualTrigger.run(ctx({ sample: "not json at all" }))).resolves.toEqual({
      payload: {},
    });
  });

  it("defaults the sample to an empty object", async () => {
    const inputs = manualTrigger.inputs.parse({});
    expect(inputs.sample).toBe("{}");
    await expect(manualTrigger.run(ctx(inputs))).resolves.toEqual({ payload: {} });
  });
});

describe("http.request", () => {
  it("sends the request and returns the parsed JSON body", async () => {
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ ok: true, items: [1, 2] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req_1" },
      }),
    );

    const inputs = httpRequest.inputs.parse({
      url: "https://api.example.com/things",
      headers: { "x-api-key": "abc" },
    });
    const out = await httpRequest.run(ctx(inputs));

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, items: [1, 2] });
    expect(out.headers["x-request-id"]).toBe("req_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/things");
    expect(init?.method).toBe("GET");
    expect(headersOf(init)["x-api-key"]).toBe("abc");
    expect(init?.body).toBeUndefined();
  });

  it("returns text when the response is not JSON", async () => {
    mockFetch(async () =>
      new Response("plain words", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const out = await httpRequest.run(
      ctx(httpRequest.inputs.parse({ url: "https://api.example.com/text" })),
    );
    expect(out.body).toBe("plain words");
  });

  it("forwards the raw body on a POST", async () => {
    const fetchMock = mockFetch(async () => new Response("{}", { status: 201, headers: { "content-type": "application/json" } }));

    await httpRequest.run(
      ctx(
        httpRequest.inputs.parse({
          url: "https://api.example.com/things",
          method: "POST",
          body: '{"name":"x"}',
        }),
      ),
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"name":"x"}');
  });

  it("throws a ConnectorError carrying the status and retry-after on 500", async () => {
    mockFetch(async () =>
      new Response("upstream exploded", {
        status: 500,
        headers: { "content-type": "text/plain", "retry-after": "30" },
      }),
    );

    const error = await caught(
      httpRequest.run(ctx(httpRequest.inputs.parse({ url: "https://api.example.com/boom" }))),
    );

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).status).toBe(500);
    expect((error as ConnectorError).retryAfter).toBe("30");
    expect((error as ConnectorError).message).toContain("upstream exploded");
  });

  it("rejects a url that is not a url", () => {
    expect(httpRequest.inputs.safeParse({ url: "nope" }).success).toBe(false);
  });
});

describe("email.send", () => {
  it("throws a ConnectorError when no key is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = mockFetch(async () => new Response("{}", { status: 200 }));

    const error = await caught(
      emailSend.run(
        ctx(emailSend.inputs.parse({ to: "a@example.com", subject: "Hi", text: "There" })),
      ),
    );

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to Resend with a User-Agent and returns the message id", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ id: "re_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const out = await emailSend.run(
      ctx(
        emailSend.inputs.parse({ to: "a@example.com", subject: "Hi", text: "There" }),
        { apiKey: "re_credential_key" },
      ),
    );

    expect(out).toEqual({ id: "re_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");

    const headers = headersOf(init);
    expect(headers["User-Agent"]).toBeTruthy();
    expect(headers.Authorization).toBe("Bearer re_credential_key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.from).toBe("PapaFlow <onboarding@resend.dev>");
    expect(body.to).toEqual(["a@example.com"]);
    expect(body.subject).toBe("Hi");
    expect(body.text).toBe("There");
  });

  it("falls back to RESEND_API_KEY and honours an explicit from", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_key");
    const fetchMock = mockFetch(async () =>
      new Response(JSON.stringify({ id: "re_456" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const out = await emailSend.run(
      ctx(
        emailSend.inputs.parse({
          to: "a@example.com",
          subject: "Hi",
          text: "There",
          from: "me@mine.dev",
        }),
      ),
    );

    expect(out).toEqual({ id: "re_456" });
    const [, init] = fetchMock.mock.calls[0];
    expect(headersOf(init).Authorization).toBe("Bearer re_env_key");
    expect((JSON.parse(String(init?.body)) as { from: string }).from).toBe("me@mine.dev");
  });

  it("throws a ConnectorError with the response text on a non-2xx", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_env_key");
    mockFetch(async () =>
      new Response('{"statusCode":422,"message":"Invalid `to` field"}', {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await caught(
      emailSend.run(
        ctx(emailSend.inputs.parse({ to: "a@example.com", subject: "Hi", text: "There" })),
      ),
    );

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).status).toBe(422);
    expect((error as ConnectorError).message).toContain("Invalid `to` field");
  });

  it("requires a valid recipient, subject and text", () => {
    expect(emailSend.inputs.safeParse({ to: "nope", subject: "s", text: "t" }).success).toBe(false);
    expect(emailSend.inputs.safeParse({ to: "a@example.com", subject: "", text: "t" }).success).toBe(false);
    expect(emailSend.inputs.safeParse({ to: "a@example.com", subject: "s", text: "" }).success).toBe(false);
  });
});
