import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

/**
 * The Builder agent's write surface.
 *
 * Everything the agent can do to a workflow goes through these five mutations, so this is where the
 * rules that do not depend on the node registry live: the caller is the engine, the workflow is the
 * caller's organisation's, keys stay unique, edges join nodes that exist, and every write bumps the
 * version with `lastEditSource: "builder"` — which is the flag the open canvas adopts on.
 */

// `guard()` reads process.env at call time; set before any `convexTest` instance can race it.
process.env.ENGINE_SECRET = "test-secret";

const SECRET = "test-secret";
const ISSUER = "https://x.clerk.accounts.dev";
const ORG = "org_1";
const USER = "user_1";

async function setup() {
  const t = convexTest(schema, modules);
  const orgA = t.withIdentity({ subject: USER, issuer: ISSUER, org_id: ORG });
  const workflowId = await orgA.mutation(api.workflows.create, { name: "Flow" });
  return { t, orgA, workflowId };
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

type Harness = Awaited<ReturnType<typeof setup>>;

function add(
  { t, workflowId }: Pick<Harness, "t" | "workflowId">,
  nodeType: string,
  overrides: {
    label?: string;
    inputs?: Record<string, unknown>;
    isTrigger?: boolean;
    orgId?: string;
    secret?: string;
  } = {},
) {
  return t.mutation(api.builder.addNode, {
    secret: overrides.secret ?? SECRET,
    workflowId,
    orgId: overrides.orgId ?? ORG,
    userId: USER,
    nodeType,
    label: overrides.label ?? nodeType,
    inputs: overrides.inputs ?? {},
    isTrigger: overrides.isTrigger ?? false,
  });
}

function graphOf({ t, workflowId }: Pick<Harness, "t" | "workflowId">, orgId = ORG) {
  return t.query(api.builder.getGraph, { secret: SECRET, workflowId, orgId });
}

type StoredNode = { id: string; data: { key: string; nodeType: string; inputs: Record<string, unknown> } };

describe("api.builder", () => {
  test("every function refuses a wrong or missing secret", async () => {
    const { t, workflowId } = await setup();
    const unauthorized = { code: "unauthorized" };

    expect(
      await convexErrorData(
        t.query(api.builder.getGraph, { secret: "nope", workflowId, orgId: ORG }),
      ),
    ).toEqual(unauthorized);
    expect(await convexErrorData(add({ t, workflowId }, "manual.trigger", { secret: "" }))).toEqual(
      unauthorized,
    );
    expect(
      await convexErrorData(
        t.mutation(api.builder.activate, {
          secret: "nope",
          workflowId,
          orgId: ORG,
          userId: USER,
        }),
      ),
    ).toEqual(unauthorized);
  });

  test("addNode appends a node, names it and bumps the version as the Builder", async () => {
    const { t, orgA, workflowId } = await setup();

    const created = await add({ t, workflowId }, "manual.trigger", { isTrigger: true });
    expect(created.key).toBe("manual_trigger_1");
    expect(created.version).toBe(2);

    const doc = await orgA.query(api.workflows.get, { id: workflowId });
    expect(doc.version).toBe(2);
    expect(doc.lastEditSource).toBe("builder");
    expect(doc.lastEditedBy).toBe(USER);
    expect(doc.graph.triggerId).toBe(created.nodeId);

    const [node] = doc.graph.nodes as StoredNode[];
    expect(node.data.nodeType).toBe("manual.trigger");
    expect(node.data.key).toBe("manual_trigger_1");
  });

  test("keys are unique per workflow and reuse the smallest free number", async () => {
    const { t, workflowId } = await setup();

    const first = await add({ t, workflowId }, "http.request");
    const second = await add({ t, workflowId }, "http.request");
    expect([first.key, second.key]).toEqual(["http_request_1", "http_request_2"]);

    await t.mutation(api.builder.removeNode, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      node: "http_request_1",
    });
    const third = await add({ t, workflowId }, "http.request");
    expect(third.key).toBe("http_request_1");
  });

  test("addNode lays nodes out left to right", async () => {
    const { t, workflowId } = await setup();
    await add({ t, workflowId }, "manual.trigger", { isTrigger: true });
    await add({ t, workflowId }, "http.request");

    const graph = await graphOf({ t, workflowId });
    const positions = (graph?.graph.nodes as { position: { x: number } }[]).map(
      (node) => node.position.x,
    );
    expect(positions[1]).toBeGreaterThan(positions[0]);
  });

  test("addNode refuses a second trigger", async () => {
    const { t, workflowId } = await setup();
    await add({ t, workflowId }, "manual.trigger", { isTrigger: true });

    const data = await convexErrorData(
      add({ t, workflowId }, "webhook.trigger", { isTrigger: true }),
    );
    expect(data.code).toBe("trigger_exists");
    expect(String(data.message)).toContain("manual_trigger_1");
  });

  test("connectNodes wires two nodes by key and refuses everything that is not an edge", async () => {
    const { t, workflowId } = await setup();
    const trigger = await add({ t, workflowId }, "manual.trigger", { isTrigger: true });
    await add({ t, workflowId }, "http.request");

    const edge = await t.mutation(api.builder.connectNodes, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      from: "manual_trigger_1",
      to: "http_request_1",
    });
    expect(edge.version).toBe(4);

    const graph = await graphOf({ t, workflowId });
    const [stored] = graph?.graph.edges as { source: string; target: string }[];
    expect(stored.source).toBe(trigger.nodeId);

    // The same pair on the same handle twice.
    expect(
      (
        await convexErrorData(
          t.mutation(api.builder.connectNodes, {
            secret: SECRET,
            workflowId,
            orgId: ORG,
            userId: USER,
            from: "manual_trigger_1",
            to: "http_request_1",
          }),
        )
      ).code,
    ).toBe("edge_exists");

    // …but a different handle is a different edge.
    const branch = await t.mutation(api.builder.connectNodes, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      from: "manual_trigger_1",
      to: "http_request_1",
      sourceHandle: "true",
    });
    expect(branch.edgeId).not.toBe(edge.edgeId);

    expect(
      (
        await convexErrorData(
          t.mutation(api.builder.connectNodes, {
            secret: SECRET,
            workflowId,
            orgId: ORG,
            userId: USER,
            from: "manual_trigger_1",
            to: "manual_trigger_1",
          }),
        )
      ).code,
    ).toBe("invalid_edge");

    expect(
      (
        await convexErrorData(
          t.mutation(api.builder.connectNodes, {
            secret: SECRET,
            workflowId,
            orgId: ORG,
            userId: USER,
            from: "manual_trigger_1",
            to: "ghost",
          }),
        )
      ).code,
    ).toBe("node_not_found");
  });

  test("configureNode merges into what is there rather than replacing it", async () => {
    const { t, workflowId } = await setup();
    await add({ t, workflowId }, "slack.postMessage", { inputs: { channel: "#general" } });

    await t.mutation(api.builder.configureNode, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      node: "slack_postmessage_1",
      inputs: { connectionId: "conn_1" },
    });
    const result = await t.mutation(api.builder.configureNode, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      node: "slack_postmessage_1",
      inputs: { text: "hello" },
      label: "Announce",
    });

    expect(result.inputs).toEqual({ channel: "#general", connectionId: "conn_1", text: "hello" });

    const graph = await graphOf({ t, workflowId });
    const [node] = graph?.graph.nodes as (StoredNode & { data: { label: string } })[];
    expect(node.data.label).toBe("Announce");
    expect(result.version).toBe(4);
  });

  test("configureNode refuses a node that is not there and a non-object body", async () => {
    const { t, workflowId } = await setup();
    await add({ t, workflowId }, "http.request");

    expect(
      (
        await convexErrorData(
          t.mutation(api.builder.configureNode, {
            secret: SECRET,
            workflowId,
            orgId: ORG,
            userId: USER,
            node: "ghost",
            inputs: {},
          }),
        )
      ).code,
    ).toBe("node_not_found");

    expect(
      (
        await convexErrorData(
          t.mutation(api.builder.configureNode, {
            secret: SECRET,
            workflowId,
            orgId: ORG,
            userId: USER,
            node: "http_request_1",
            inputs: "not an object",
          }),
        )
      ).code,
    ).toBe("invalid_inputs");
  });

  test("removeNode takes its edges with it and gives up the trigger", async () => {
    const { t, workflowId } = await setup();
    await add({ t, workflowId }, "manual.trigger", { isTrigger: true });
    await add({ t, workflowId }, "http.request");
    await t.mutation(api.builder.connectNodes, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      from: "manual_trigger_1",
      to: "http_request_1",
    });

    const removed = await t.mutation(api.builder.removeNode, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      node: "manual_trigger_1",
    });
    expect(removed.removedEdges).toBe(1);

    const graph = await graphOf({ t, workflowId });
    expect(graph?.graph.nodes).toHaveLength(1);
    expect(graph?.graph.edges).toHaveLength(0);
    expect(graph?.graph.triggerId).toBeUndefined();
  });

  test("activate marks the workflow live without bumping the graph version", async () => {
    const { t, orgA, workflowId } = await setup();
    await add({ t, workflowId }, "manual.trigger", { isTrigger: true });

    const before = await orgA.query(api.workflows.get, { id: workflowId });
    const result = await t.mutation(api.builder.activate, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
    });

    expect(result.status).toBe("active");
    const after = await orgA.query(api.workflows.get, { id: workflowId });
    expect(after.status).toBe("active");
    expect(after.version).toBe(before.version);
  });

  test("another organisation's workflow reads as absent and cannot be edited", async () => {
    const { t, workflowId } = await setup();

    expect(await graphOf({ t, workflowId }, "org_2")).toBeNull();

    for (const attempt of [
      add({ t, workflowId }, "http.request", { orgId: "org_2" }),
      t.mutation(api.builder.connectNodes, {
        secret: SECRET,
        workflowId,
        orgId: "org_2",
        userId: "user_2",
        from: "a",
        to: "b",
      }),
      t.mutation(api.builder.configureNode, {
        secret: SECRET,
        workflowId,
        orgId: "org_2",
        userId: "user_2",
        node: "a",
        inputs: {},
      }),
      t.mutation(api.builder.removeNode, {
        secret: SECRET,
        workflowId,
        orgId: "org_2",
        userId: "user_2",
        node: "a",
      }),
      t.mutation(api.builder.activate, {
        secret: SECRET,
        workflowId,
        orgId: "org_2",
        userId: "user_2",
      }),
    ]) {
      expect(await convexErrorData(attempt)).toEqual({ code: "not_found" });
    }
  });

  test("updateNode moves and renames one node without touching its configuration", async () => {
    const harness = await setup();
    const { t, workflowId } = harness;
    const { key } = await add(harness, "http.request", { inputs: { url: "https://x.test" } });

    const moved = await t.mutation(api.builder.updateNode, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      node: key,
      label: "Fetch the lead",
      position: { x: 640, y: 320 },
    });
    expect(moved).toMatchObject({ key, version: 3 });

    const graph = await graphOf(harness);
    const stored = (graph?.graph.nodes as unknown[])[0] as StoredNode & {
      position: { x: number; y: number };
      data: { label: string };
    };
    expect(stored.position).toEqual({ x: 640, y: 320 });
    expect(stored.data.label).toBe("Fetch the lead");
    // The point of a separate mutation: the inputs are none of its business.
    expect(stored.data.inputs).toEqual({ url: "https://x.test" });
  });

  test("updateNode refuses a node that is not there, and a call that changes nothing", async () => {
    const harness = await setup();
    const { t, workflowId } = harness;
    const { key } = await add(harness, "http.request");

    expect(
      await convexErrorData(
        t.mutation(api.builder.updateNode, {
          secret: SECRET,
          workflowId,
          orgId: ORG,
          userId: USER,
          node: "nope",
          label: "x",
        }),
      ),
    ).toMatchObject({ code: "node_not_found" });

    expect(
      await convexErrorData(
        t.mutation(api.builder.updateNode, {
          secret: SECRET,
          workflowId,
          orgId: ORG,
          userId: USER,
          node: key,
        }),
      ),
    ).toMatchObject({ code: "nothing_to_do" });
  });

  test("rename trims the name and leaves the graph version alone", async () => {
    const harness = await setup();
    const { t, workflowId } = harness;
    await add(harness, "http.request");
    const before = await graphOf(harness);

    const renamed = await t.mutation(api.builder.rename, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
      name: "  New leads to Airtable  ",
    });
    expect(renamed).toEqual({ name: "New leads to Airtable", version: before?.version });
    expect((await graphOf(harness))?.name).toBe("New leads to Airtable");

    for (const name of ["", "   ", "x".repeat(200)]) {
      expect(
        await convexErrorData(
          t.mutation(api.builder.rename, { secret: SECRET, workflowId, orgId: ORG, userId: USER, name }),
        ),
      ).toMatchObject({ code: "invalid_name" });
    }
  });

  test("listRuns and getRun read this workflow's runs, newest first, and nobody else's", async () => {
    const harness = await setup();
    const { t, workflowId } = harness;

    // A second workflow in the same org: its runs must not leak into this chat.
    const otherWorkflowId = await t
      .withIdentity({ subject: USER, issuer: ISSUER, org_id: ORG })
      .mutation(api.workflows.create, { name: "Other" });

    const { older, newer, foreign } = await t.run(async (ctx) => {
      const base = {
        orgId: ORG,
        workflowVersion: 1,
        planSlug: "pro",
        trigger: { type: "manual", payload: {} },
      };
      const older = await ctx.db.insert("executions", {
        ...base,
        workflowId,
        status: "completed" as const,
        startedAt: 1_000,
        finishedAt: 1_500,
      });
      const newer = await ctx.db.insert("executions", {
        ...base,
        workflowId,
        status: "failed" as const,
        startedAt: 2_000,
        finishedAt: 2_400,
        error: "airtable_create_record_1 failed",
      });
      const foreign = await ctx.db.insert("executions", {
        ...base,
        workflowId: otherWorkflowId,
        status: "completed" as const,
        startedAt: 3_000,
      });

      await ctx.db.insert("steps", {
        orgId: ORG,
        executionId: newer,
        nodeId: "n1",
        nodeType: "manual.trigger",
        status: "success" as const,
        attempt: 1,
        output: { name: "Sam" },
        startedAt: 2_000,
        finishedAt: 2_050,
      });
      await ctx.db.insert("steps", {
        orgId: ORG,
        executionId: newer,
        nodeId: "n2",
        nodeType: "airtable.createRecord",
        status: "failed" as const,
        attempt: 1,
        input: { baseId: "app1", fields: [] },
        error: "Every field was empty",
        warnings: ["{{ trigger.email }}: not found"],
        startedAt: 2_100,
        finishedAt: 2_400,
      });

      return { older, newer, foreign };
    });

    const runs = await t.query(api.builder.listRuns, { secret: SECRET, workflowId, orgId: ORG });
    expect(runs.map((run) => run.executionId)).toEqual([newer, older]);
    expect(runs[0]).toMatchObject({
      status: "failed",
      triggerType: "manual",
      error: "airtable_create_record_1 failed",
    });

    const limited = await t.query(api.builder.listRuns, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      limit: 1,
    });
    expect(limited).toHaveLength(1);

    const detail = await t.query(api.builder.getRun, {
      secret: SECRET,
      executionId: newer,
      workflowId,
      orgId: ORG,
    });
    expect(detail?.steps.map((step) => step.nodeId)).toEqual(["n1", "n2"]);
    expect(detail?.steps[1]).toMatchObject({
      status: "failed",
      error: "Every field was empty",
      warnings: ["{{ trigger.email }}: not found"],
    });

    // A run of another workflow — same org, same chat's secret — is simply not there.
    expect(
      await t.query(api.builder.getRun, {
        secret: SECRET,
        executionId: foreign,
        workflowId,
        orgId: ORG,
      }),
    ).toBeNull();
  });

  test("the run reads refuse a wrong secret and another organisation's workflow", async () => {
    const { t, workflowId } = await setup();

    expect(
      await convexErrorData(
        t.query(api.builder.listRuns, { secret: "nope", workflowId, orgId: ORG }),
      ),
    ).toEqual({ code: "unauthorized" });

    expect(
      await convexErrorData(
        t.query(api.builder.listRuns, { secret: SECRET, workflowId, orgId: "org_2" }),
      ),
    ).toEqual({ code: "not_found" });
  });

  test("startSession reuses this user's open chat and records the eve session id", async () => {
    const { t, workflowId } = await setup();

    const first = await t.mutation(api.builder.startSession, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
    });
    const again = await t.mutation(api.builder.startSession, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
    });
    expect(again.builderSessionId).toBe(first.builderSessionId);
    expect(again.eveSessionId).toBe("");

    // A different member of the same org gets their own chat.
    const other = await t.mutation(api.builder.startSession, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: "user_2",
    });
    expect(other.builderSessionId).not.toBe(first.builderSessionId);

    await t.mutation(api.builder.attachEveSession, {
      secret: SECRET,
      builderSessionId: first.builderSessionId as Id<"builderSessions">,
      orgId: ORG,
      userId: USER,
      eveSessionId: "wrun_123",
    });
    const resumed = await t.mutation(api.builder.startSession, {
      secret: SECRET,
      workflowId,
      orgId: ORG,
      userId: USER,
    });
    expect(resumed.eveSessionId).toBe("wrun_123");

    // Another member cannot claim someone else's chat row.
    expect(
      await convexErrorData(
        t.mutation(api.builder.attachEveSession, {
          secret: SECRET,
          builderSessionId: first.builderSessionId as Id<"builderSessions">,
          orgId: ORG,
          userId: "user_2",
          eveSessionId: "wrun_456",
        }),
      ),
    ).toEqual({ code: "not_found" });
  });
});
