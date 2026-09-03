import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/connections/:id/pick` with `kind: "models"` — the list behind every AI node's model
 * dropdown.
 *
 * No AI connector implements `pick`: each one's `test()` already stored the provider's list on the
 * row (`meta.models`, CLAUDE.md rule 11), so this kind is answered from Convex without a provider
 * call. What the tests hold it to is that shape — ids and labels out of `meta`, the stored
 * credential never anywhere near the answer (rule 1), and no network at all.
 */

const { getConnectionSealed } = vi.hoisted(() => ({ getConnectionSealed: vi.fn() }));
vi.mock("@/lib/engine-client", () => ({ getConnectionSealed }));

/** The vault, stubbed: these tests are about what comes *out*, with a real plaintext in hand. */
const { open, SECRET } = vi.hoisted(() => {
  const SECRET = { apiKey: "sk-live-DO-NOT-LEAK", botToken: "bot-DO-NOT-LEAK" };
  return { open: vi.fn(() => SECRET), SECRET };
});
vi.mock("@/lib/vault", () => ({
  open,
  aadFor: (orgId: string, connectionId: string) => `${orgId}:${connectionId}`,
  seal: vi.fn(),
}));

const { ConnectionRequestError, connectionErrorResponse, modelOptions, pickConnectionOptions } =
  await import("@/lib/connections-server");

const ORG = "org_1";
const CONNECTION = "conn_1";

/** A stored connection as the engine hands it over: ciphertext plus the connector's own `meta`. */
function row(provider: string, meta: Record<string, unknown>) {
  return {
    _id: CONNECTION,
    orgId: ORG,
    provider,
    kind: "apiKey",
    label: `${provider} (…2345)`,
    status: "active",
    secret: { iv: "aaaa", ciphertext: "bbbb", tag: "cccc", keyId: "k1" },
    meta,
  };
}

function pick(kind = "models") {
  return pickConnectionOptions({ connectionId: CONNECTION, orgId: ORG, kind });
}

beforeEach(() => {
  vi.clearAllMocks();
  open.mockReturnValue(SECRET);
  // Nothing here may reach the network: a model list that costs a provider round-trip is the bug.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("the models picker must not call a provider");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("modelOptions", () => {
  it("turns the stored list into options whose label is the id", () => {
    expect(modelOptions({ models: ["gpt-5", "o4-mini"], fetchedAt: 1_700_000_000_000 })).toEqual([
      { id: "gpt-5", label: "gpt-5" },
      { id: "o4-mini", label: "o4-mini" },
    ]);
  });

  it("answers with nothing when the connection has no list", () => {
    // Older rows, and connectors whose discovery came back empty (fal without catalogue access).
    expect(modelOptions({})).toEqual([]);
    expect(modelOptions({ models: [] })).toEqual([]);
    expect(modelOptions({ models: "gpt-5" })).toEqual([]);
    expect(modelOptions({ models: null })).toEqual([]);
  });

  it("keeps only usable ids: strings, trimmed, once each", () => {
    expect(modelOptions({ models: ["gpt-5", " gpt-5 ", "", "   ", 7, null, "o4-mini"] })).toEqual([
      { id: "gpt-5", label: "gpt-5" },
      { id: "o4-mini", label: "o4-mini" },
    ]);
  });

  it("reads `models` and nothing else off meta", () => {
    // `meta` is a connector's scratch pad — none of the rest of it belongs in a model dropdown.
    const options = modelOptions({
      models: ["gpt-5"],
      fetchedAt: 1,
      limitRemaining: 42,
      chat_ids: [{ id: 5, title: "ops" }],
    });
    expect(options).toEqual([{ id: "gpt-5", label: "gpt-5" }]);
  });
});

describe("pickConnectionOptions({ kind: 'models' })", () => {
  it("serves an AI connection's stored list without calling the provider", async () => {
    getConnectionSealed.mockResolvedValue(
      row("openai", { models: ["gpt-5", "o4-mini"], fetchedAt: 1 }),
    );

    expect(await pick()).toEqual([
      { id: "gpt-5", label: "gpt-5" },
      { id: "o4-mini", label: "o4-mini" },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers an empty list for a connection stored before its models were captured", async () => {
    // The config panel turns this into a text box with "re-test it on the Connections page".
    getConnectionSealed.mockResolvedValue(row("anthropic", {}));

    expect(await pick()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never puts a credential in the answer", async () => {
    getConnectionSealed.mockResolvedValue(
      row("openai", { models: ["gpt-5"], fetchedAt: 1, limitRemaining: 42 }),
    );

    const options = await pick();

    // Every option is exactly `{ id, label }` — no field a secret could ride out on.
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual(["id", "label"]);
    }
    const answer = JSON.stringify(options);
    expect(answer).not.toContain(SECRET.apiKey);
    expect(answer).not.toContain(SECRET.botToken);
    expect(answer).not.toContain("apiKey");
    expect(answer).not.toContain("limitRemaining");
  });

  it("falls back to the stored list for a connector that does not know the kind", async () => {
    // Telegram has a picker (chats), and answers `[]` for every other kind. An AI connector that
    // grows a list of its own must not lose its model dropdown to that.
    getConnectionSealed.mockResolvedValue(row("telegram", { models: ["some-model"] }));

    expect(await pick()).toEqual([{ id: "some-model", label: "some-model" }]);
  });

  it("still refuses a kind nothing can answer", async () => {
    getConnectionSealed.mockResolvedValue(row("openai", { models: ["gpt-5"] }));

    const thrown = await pick("channels").catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ConnectionRequestError);
    expect(connectionErrorResponse(thrown)).toMatchObject({
      status: 400,
      body: { code: "no_picker" },
    });
  });

  it("does not answer for another org's connection", async () => {
    getConnectionSealed.mockResolvedValue({ ...row("openai", { models: ["gpt-5"] }), orgId: "org_2" });

    const thrown = await pick().catch((error: unknown) => error);

    expect(connectionErrorResponse(thrown)).toMatchObject({
      status: 404,
      body: { code: "not_found" },
    });
  });
});
