import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

// `guard()` reads process.env at call time; set before any convexTest instance exists so nothing
// can race it (same reasoning as engine.test.ts).
process.env.ENGINE_SECRET = "test-secret";

const SECRET = "test-secret";
const ISSUER = "https://x.clerk.accounts.dev";
const ORG = "org_1";
const OTHER_ORG = "org_2";

/** A plausible envelope. The tests never encrypt anything — `lib/vault.ts` owns that. */
const SEALED = { v: 1 as const, keyId: "k1", iv: "aXYtYnl0ZXM=", tag: "dGFn", ct: "Y2lwaGVy" };

/**
 * Everything `list`/`get` expose for a row without optional fields. `secret` is conspicuously
 * absent; `expiresAt` and `requiresFeature` join the list only when the row actually has them
 * (Convex drops `undefined` on the wire).
 */
const PROJECTED_KEYS = [
  "_creationTime",
  "_id",
  "createdBy",
  "hint",
  "kind",
  "label",
  "meta",
  "provider",
  "scopes",
  "status",
  "updatedAt",
];

function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    orgA: t.withIdentity({ subject: "user_1", issuer: ISSUER, org_id: ORG }),
    orgB: t.withIdentity({ subject: "user_2", issuer: ISSUER, org_id: OTHER_ORG }),
  };
}

type Harness = ReturnType<typeof setup>;

/** Creates a connection the way `/api/connections` does: insert, then patch the sealed secret. */
async function addConnection(
  { t }: Pick<Harness, "t">,
  overrides: {
    orgId?: string;
    provider?: string;
    label?: string;
    meta?: Record<string, unknown>;
    requiresFeature?: string;
    seal?: boolean;
  } = {},
): Promise<Id<"connections">> {
  const orgId = overrides.orgId ?? ORG;
  const connectionId = await t.mutation(api.engine.createConnection, {
    secret: SECRET,
    orgId,
    createdBy: "user_1",
    provider: overrides.provider ?? "anthropic",
    kind: "apiKey",
    label: overrides.label ?? "Anthropic (…abcd)",
    hint: "abcd",
    meta: overrides.meta ?? { models: ["claude-x"], fetchedAt: 1 },
    ...(overrides.requiresFeature ? { requiresFeature: overrides.requiresFeature } : {}),
  });

  if (overrides.seal !== false) {
    await t.mutation(api.engine.patchConnectionSecret, {
      secret: SECRET,
      connectionId,
      orgId,
      sealed: SEALED,
    });
  }
  return connectionId;
}

/** Awaits a rejection, asserts it is a ConvexError and hands back its structured `data`. */
async function convexErrorData(promise: Promise<unknown>) {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(ConvexError);
  return (thrown as ConvexError<Record<string, Value>>).data;
}

describe("connections queries", () => {
  test("list projects the row and never returns the sealed secret", async () => {
    const h = setup();
    await addConnection(h, {
      meta: {
        models: ["claude-x", "claude-y"],
        fetchedAt: 42,
        team_name: "Acme",
        note: "handy",
        // A connector should never write these; if one does, they stop at the projection.
        refresh_token: "leaked",
        apiKey: "leaked",
        clientSecret: "leaked",
      },
    });

    const [row] = await h.orgA.query(api.connections.list, {});

    expect(Object.keys(row).sort()).toEqual(PROJECTED_KEYS);
    expect("secret" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain("cipher");
    expect(row.meta).toEqual({
      models: ["claude-x", "claude-y"],
      fetchedAt: 42,
      team_name: "Acme",
      note: "handy",
    });
    expect(row.hint).toBe("abcd");
    expect(row.status).toBe("active");
  });

  test("list is org-scoped and newest first", async () => {
    const h = setup();
    await addConnection(h, { label: "first" });
    await addConnection(h, { label: "second" });
    await addConnection(h, { orgId: OTHER_ORG, label: "theirs" });

    expect((await h.orgA.query(api.connections.list, {})).map((c) => c.label)).toEqual([
      "second",
      "first",
    ]);
    expect((await h.orgB.query(api.connections.list, {})).map((c) => c.label)).toEqual(["theirs"]);
  });

  test("get projects the same fields and refuses another org's connection", async () => {
    const h = setup();
    const connectionId = await addConnection(h, { requiresFeature: "pro_connectors" });

    const row = await h.orgA.query(api.connections.get, { id: connectionId });
    expect(Object.keys(row).sort()).toEqual([...PROJECTED_KEYS, "requiresFeature"].sort());
    expect("secret" in row).toBe(false);
    expect(row.requiresFeature).toBe("pro_connectors");

    expect(await convexErrorData(h.orgB.query(api.connections.get, { id: connectionId }))).toEqual({
      code: "not_found",
    });
  });

  test("listByProvider filters to one provider within the org", async () => {
    const h = setup();
    await addConnection(h, { provider: "anthropic", label: "claude" });
    await addConnection(h, { provider: "openai", label: "gpt" });
    await addConnection(h, { orgId: OTHER_ORG, provider: "openai", label: "theirs" });

    expect(
      (await h.orgA.query(api.connections.listByProvider, { provider: "openai" })).map(
        (c) => c.label,
      ),
    ).toEqual(["gpt"]);
    expect(
      await h.orgB.query(api.connections.listByProvider, { provider: "anthropic" }),
    ).toEqual([]);
  });

  test("the projected queries need an organisation", async () => {
    const { t } = setup();
    await expect(t.query(api.connections.list, {})).rejects.toThrow("unauthenticated");
  });
});

describe("api.engine connection functions", () => {
  test("create inserts an unusable placeholder that patchConnectionSecret fills in", async () => {
    const h = setup();
    const connectionId = await addConnection(h, { seal: false });

    await h.t.run(async (ctx) => {
      const row = await ctx.db.get(connectionId);
      // Nothing can be sealed before the id exists, so the row starts unusable.
      expect(row?.secret).toEqual({ v: 1, keyId: "pending", iv: "", tag: "", ct: "" });
      expect(row?.status).toBe("needs_reconnect");
      expect(row?.scopes).toEqual([]);
    });

    await h.t.mutation(api.engine.patchConnectionSecret, {
      secret: SECRET,
      connectionId,
      orgId: ORG,
      sealed: SEALED,
    });

    await h.t.run(async (ctx) => {
      const row = await ctx.db.get(connectionId);
      expect(row?.secret).toEqual(SEALED);
      expect(row?.status).toBe("active");
    });
  });

  test("getConnectionSealed hands the blob to the engine and nobody else", async () => {
    const h = setup();
    const connectionId = await addConnection(h, { requiresFeature: "pro_connectors" });

    expect(
      await convexErrorData(
        h.t.query(api.engine.getConnectionSealed, { secret: "not-the-secret", connectionId }),
      ),
    ).toEqual({ code: "unauthorized" });

    expect(
      await convexErrorData(
        h.t.query(api.engine.getConnectionSealed, { secret: "", connectionId }),
      ),
    ).toEqual({ code: "unauthorized" });

    expect(await h.t.query(api.engine.getConnectionSealed, { secret: SECRET, connectionId })).toEqual(
      {
        orgId: ORG,
        provider: "anthropic",
        kind: "apiKey",
        secret: SEALED,
        status: "active",
      },
    );
  });

  test("getConnectionSealed is null for a connection that no longer exists", async () => {
    const h = setup();
    const connectionId = await addConnection(h);
    await h.t.mutation(api.engine.removeConnection, { secret: SECRET, connectionId, orgId: ORG });

    expect(await h.t.query(api.engine.getConnectionSealed, { secret: SECRET, connectionId })).toBe(
      null,
    );
  });

  test("updateConnectionMeta merges and setConnectionStatus records a failed test", async () => {
    const h = setup();
    const connectionId = await addConnection(h, { meta: { models: ["old"], team_name: "Acme" } });

    await h.t.mutation(api.engine.updateConnectionMeta, {
      secret: SECRET,
      connectionId,
      orgId: ORG,
      meta: { models: ["new"], fetchedAt: 7 },
    });
    await h.t.mutation(api.engine.setConnectionStatus, {
      secret: SECRET,
      connectionId,
      orgId: ORG,
      status: "needs_reconnect",
    });

    const row = await h.orgA.query(api.connections.get, { id: connectionId });
    expect(row.meta).toEqual({ models: ["new"], fetchedAt: 7, team_name: "Acme" });
    expect(row.status).toBe("needs_reconnect");
  });

  test("every connection mutation re-checks orgId against the row", async () => {
    const h = setup();
    const connectionId = await addConnection(h);
    const notFound = { code: "not_found" };

    expect(
      await convexErrorData(
        h.t.mutation(api.engine.patchConnectionSecret, {
          secret: SECRET,
          connectionId,
          orgId: OTHER_ORG,
          sealed: { ...SEALED, ct: "other" },
        }),
      ),
    ).toEqual(notFound);

    expect(
      await convexErrorData(
        h.t.mutation(api.engine.setConnectionStatus, {
          secret: SECRET,
          connectionId,
          orgId: OTHER_ORG,
          status: "revoked",
        }),
      ),
    ).toEqual(notFound);

    expect(
      await convexErrorData(
        h.t.mutation(api.engine.updateConnectionMeta, {
          secret: SECRET,
          connectionId,
          orgId: OTHER_ORG,
          meta: { models: [] },
        }),
      ),
    ).toEqual(notFound);

    expect(
      await convexErrorData(
        h.t.mutation(api.engine.removeConnection, {
          secret: SECRET,
          connectionId,
          orgId: OTHER_ORG,
        }),
      ),
    ).toEqual(notFound);

    // The refused calls changed nothing.
    await h.t.run(async (ctx) => {
      const row = await ctx.db.get(connectionId);
      expect(row?.secret).toEqual(SEALED);
      expect(row?.status).toBe("active");
    });
  });

  test("every connection function refuses a wrong secret", async () => {
    const h = setup();
    const connectionId = await addConnection(h);
    const unauthorized = { code: "unauthorized" };

    expect(
      await convexErrorData(
        h.t.mutation(api.engine.createConnection, {
          secret: "nope",
          orgId: ORG,
          createdBy: "user_1",
          provider: "openai",
          kind: "apiKey",
          label: "OpenAI",
          hint: "abcd",
          meta: {},
        }),
      ),
    ).toEqual(unauthorized);

    expect(
      await convexErrorData(
        h.t.mutation(api.engine.removeConnection, { secret: "nope", connectionId, orgId: ORG }),
      ),
    ).toEqual(unauthorized);

    expect(await h.orgA.query(api.connections.list, {})).toHaveLength(1);
  });

  test("internal.connections.getSealed is the only door to the ciphertext", async () => {
    const h = setup();
    const connectionId = await addConnection(h);

    const row = await h.t.query(internal.connections.getSealed, { connectionId });
    expect(row?.secret).toEqual(SEALED);
  });
});
