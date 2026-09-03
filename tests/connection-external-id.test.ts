import { beforeEach, describe, expect, it, vi } from "vitest";

import { externalIdOf } from "@/connectors/define";
import { CONNECTORS } from "@/connectors/registry";
import { createConnectionFromInput, retestConnection } from "@/lib/connections-server";

/**
 * `connections.externalId` — the provider's own id for the account behind a credential, copied out
 * of `meta` into a column at create and re-test time.
 *
 * It exists for exactly one reason: `POST /api/events/slack` is a single URL for the whole
 * deployment (the app manifest has to name it before any connection exists) and so has to find a
 * connection from the workspace id inside a delivery. `meta` is `v.any()` in Convex and cannot be
 * indexed, so the one key that matters is promoted — which key being the connector's own business
 * (`ConnectorDef.externalIdFrom`), not this module's.
 *
 * The two writes tested here are the whole contract: a connector that declares the key gets the
 * column filled in, one that does not never sees the field, and a re-test moves it when the
 * credential turns out to belong somewhere else.
 */
const { createConnection, patchConnectionSecret, updateConnectionMeta, setConnectionStatus, getConnectionSealed, removeConnection } =
  vi.hoisted(() => ({
    createConnection: vi.fn(),
    patchConnectionSecret: vi.fn(),
    updateConnectionMeta: vi.fn(),
    setConnectionStatus: vi.fn(),
    getConnectionSealed: vi.fn(),
    removeConnection: vi.fn(),
  }));

vi.mock("@/lib/engine-client", () => ({
  createConnection,
  patchConnectionSecret,
  updateConnectionMeta,
  setConnectionStatus,
  getConnectionSealed,
  removeConnection,
}));
vi.mock("@/lib/vault", () => ({
  seal: () => ({ v: 1, keyId: "k1", iv: "iv", tag: "tag", ct: "ct" }),
  open: () => ({ botToken: "xoxb-stored", signingSecret: "stored-signing-secret" }),
  aadFor: (orgId: string, connectionId: string) => `${orgId}:${connectionId}`,
}));

const ORG_ID = "org_1";
const CONNECTION_ID = "cn_1";
const TEAM_ID = "T024BE7LD";

/** Clerk's `has`, standing in for an org entitled to everything. */
const has = () => true;

/** A sealed row as `api.engine.getConnectionSealed` returns one. */
const SEALED_ROW = {
  orgId: ORG_ID,
  provider: "slack",
  kind: "botToken",
  secret: { v: 1, keyId: "k1", iv: "iv", tag: "tag", ct: "ct" },
  status: "active",
  meta: { team_id: TEAM_ID },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  createConnection.mockResolvedValue(CONNECTION_ID);
  patchConnectionSecret.mockResolvedValue(undefined);
  updateConnectionMeta.mockResolvedValue(undefined);
  setConnectionStatus.mockResolvedValue(undefined);
  getConnectionSealed.mockResolvedValue(SEALED_ROW);
});

/** The `createConnection` call's arguments, which is where the column is first written. */
function createArgs(): Record<string, unknown> {
  return (createConnection.mock.calls[0] as [Record<string, unknown>])[0];
}

describe("externalIdOf", () => {
  it("reads the key the connector named, and only a usable string", () => {
    expect(externalIdOf(CONNECTORS.slack, { team_id: TEAM_ID })).toBe(TEAM_ID);
    expect(externalIdOf(CONNECTORS.slack, { team_id: "" })).toBeUndefined();
    expect(externalIdOf(CONNECTORS.slack, { team_id: 42 })).toBeUndefined();
    expect(externalIdOf(CONNECTORS.slack, {})).toBeUndefined();
    expect(externalIdOf(CONNECTORS.slack, undefined)).toBeUndefined();
    // A connector that declares no key never gets one, whatever its `meta` happens to hold.
    expect(externalIdOf(CONNECTORS.anthropic, { team_id: TEAM_ID })).toBeUndefined();
  });
});

describe("createConnectionFromInput", () => {
  it("stores the Slack workspace id in the indexed column", async () => {
    vi.spyOn(CONNECTORS.slack, "test").mockResolvedValue({
      ok: true,
      label: "Acme",
      hint: "wxyz",
      meta: { team_id: TEAM_ID, team_name: "Acme", bot_user_id: "U0BOT" },
    });

    await createConnectionFromInput({
      orgId: ORG_ID,
      userId: "user_1",
      provider: "slack",
      secret: { botToken: "xoxb-pasted", signingSecret: "pasted-signing-secret" },
      has,
    });

    expect(createArgs()).toMatchObject({
      provider: "slack",
      externalId: TEAM_ID,
      // The column is a *copy*: `meta` keeps the value it was taken from.
      meta: { team_id: TEAM_ID, team_name: "Acme" },
    });
  });

  it("sends no external id for a connector that declares no key", async () => {
    vi.spyOn(CONNECTORS.anthropic, "test").mockResolvedValue({
      ok: true,
      label: "Anthropic",
      hint: "abcd",
      meta: { models: ["claude-x"], fetchedAt: 1 },
    });

    await createConnectionFromInput({
      orgId: ORG_ID,
      userId: "user_1",
      provider: "anthropic",
      secret: { apiKey: "sk-ant-pasted" },
      has,
    });

    expect(createArgs().externalId).toBeUndefined();
  });

  it("leaves the column empty when the provider reported no workspace", async () => {
    // Not a hypothetical: `meta` is whatever a connector captured, and a provider can change what
    // it answers. A missing id must leave an unindexed row, never an empty-string one — that would
    // collide with every other connection that failed the same way.
    vi.spyOn(CONNECTORS.slack, "test").mockResolvedValue({
      ok: true,
      label: "Acme",
      hint: "wxyz",
      meta: { team_name: "Acme" },
    });

    await createConnectionFromInput({
      orgId: ORG_ID,
      userId: "user_1",
      provider: "slack",
      secret: { botToken: "xoxb-pasted" },
      has,
    });

    expect(createArgs().externalId).toBeUndefined();
  });
});

describe("retestConnection", () => {
  it("moves the indexed id when the credential now belongs to another workspace", async () => {
    vi.spyOn(CONNECTORS.slack, "test").mockResolvedValue({
      ok: true,
      label: "Other Corp",
      hint: "wxyz",
      meta: { team_id: "T77777777", team_name: "Other Corp" },
    });

    const outcome = await retestConnection({ connectionId: CONNECTION_ID, orgId: ORG_ID });

    expect(outcome.ok).toBe(true);
    expect(updateConnectionMeta).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      orgId: ORG_ID,
      meta: { team_id: "T77777777", team_name: "Other Corp" },
      externalId: "T77777777",
    });
  });

  it("is how a connection made before the column existed gets one", async () => {
    // No backfill: a re-test (or a "refresh") writes the column for any row that predates it, and
    // until then the route's `meta.team_id` scan still finds it.
    vi.spyOn(CONNECTORS.slack, "test").mockResolvedValue({
      ok: true,
      label: "Acme",
      hint: "wxyz",
      meta: { team_id: TEAM_ID },
    });

    await retestConnection({ connectionId: CONNECTION_ID, orgId: ORG_ID });

    expect(
      (updateConnectionMeta.mock.calls[0] as [Record<string, unknown>])[0].externalId,
    ).toBe(TEAM_ID);
  });

  it("writes nothing to the column for a credential that no longer works", async () => {
    vi.spyOn(CONNECTORS.slack, "test").mockResolvedValue({
      ok: false,
      error: "Slack rejected that bot token.",
    });

    const outcome = await retestConnection({ connectionId: CONNECTION_ID, orgId: ORG_ID });

    expect(outcome).toEqual({
      ok: false,
      status: "needs_reconnect",
      error: "Slack rejected that bot token.",
    });
    expect(updateConnectionMeta).not.toHaveBeenCalled();
  });
});
