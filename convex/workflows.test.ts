import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";

import { PLAN_LIMITS } from "../lib/plans";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

const ISSUER = "https://x.clerk.accounts.dev";

/** No `pla` claim → free_org → PLAN_LIMITS.free_org.workflows (3). */
function setup() {
  const t = convexTest(schema, modules);
  return {
    t,
    orgA: t.withIdentity({ subject: "user_1", issuer: ISSUER, org_id: "org_1" }),
    orgB: t.withIdentity({ subject: "user_2", issuer: ISSUER, org_id: "org_2" }),
  };
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

describe("api.workflows", () => {
  test("create seeds a draft with an empty graph, version 1 and a webhook secret", async () => {
    const { orgA } = setup();

    const id = await orgA.mutation(api.workflows.create, { name: "My first flow" });
    const doc = await orgA.query(api.workflows.get, { id });

    expect(doc.name).toBe("My first flow");
    expect(doc.status).toBe("draft");
    expect(doc.version).toBe(1);
    expect(doc.graph).toEqual({ nodes: [], edges: [] });
    expect(doc.orgId).toBe("org_1");
    expect(doc.createdBy).toBe("user_1");
    expect(doc.updatedAt).toBeGreaterThan(0);
    // 32 base64url characters, unique per workflow.
    expect(doc.webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const other = await orgA.mutation(api.workflows.create, { name: "Second" });
    const otherDoc = await orgA.query(api.workflows.get, { id: other });
    expect(otherDoc.webhookSecret).not.toBe(doc.webhookSecret);
  });

  test("create stores a starter graph when one is given", async () => {
    const { orgA } = setup();

    const graph = {
      nodes: [
        {
          id: "start",
          type: "papaflow",
          position: { x: 0, y: 0 },
          data: { nodeType: "manual.trigger", key: "start", label: "Run it", inputs: {} },
        },
      ],
      edges: [],
      triggerId: "start",
    };

    const id = await orgA.mutation(api.workflows.create, { name: "From a template", graph });
    const doc = await orgA.query(api.workflows.get, { id });

    // Stored verbatim and still version 1: a template is a head start, not a separate mode.
    expect(doc.graph).toEqual(graph);
    expect(doc.version).toBe(1);
    expect(doc.status).toBe("draft");
  });

  test("list returns the active org's workflows, newest first", async () => {
    const { orgA, orgB } = setup();

    await orgA.mutation(api.workflows.create, { name: "One" });
    await orgA.mutation(api.workflows.create, { name: "Two" });
    await orgB.mutation(api.workflows.create, { name: "Not mine" });

    const list = await orgA.query(api.workflows.list, {});

    expect(list.map((w) => w.name)).toEqual(["Two", "One"]);
    expect(list[0]).toEqual({
      _id: expect.anything(),
      _creationTime: expect.any(Number),
      name: "Two",
      status: "draft",
      version: 1,
      updatedAt: expect.any(Number),
      // Phase 9: the list carries the workflow's enabled schedule, so it can badge one.
      schedule: null,
      // An empty canvas has no trigger to chip, and a workflow nobody has run has no history.
      triggerNodeType: null,
      lastRun: null,
      recentRuns: [],
      runCount7d: 0,
    });
    // The list projection never leaks the webhook secret or the graph.
    expect(list[0]).not.toHaveProperty("webhookSecret");
    expect(list[0]).not.toHaveProperty("graph");

    expect((await orgB.query(api.workflows.list, {})).map((w) => w.name)).toEqual(["Not mine"]);
  });

  test("list reports the trigger heading each graph", async () => {
    const { orgA } = setup();

    // `triggerId` wins when it names a node.
    const named = await orgA.mutation(api.workflows.create, {
      name: "Named",
      graph: {
        nodes: [
          {
            id: "start",
            type: "papaflow",
            position: { x: 0, y: 0 },
            data: { nodeType: "form.trigger", key: "start", label: "Form", inputs: {} },
          },
        ],
        edges: [],
        triggerId: "start",
      },
    });

    // Without one, the first trigger-shaped node stands in — including the two inbound event
    // triggers, which do not say `.trigger` in their name.
    const inferred = await orgA.mutation(api.workflows.create, {
      name: "Inferred",
      graph: {
        nodes: [
          {
            id: "note",
            type: "papaflow",
            position: { x: 0, y: 0 },
            data: { nodeType: "set", key: "note", label: "Set", inputs: {} },
          },
          {
            id: "msg",
            type: "papaflow",
            position: { x: 0, y: 0 },
            data: { nodeType: "telegram.message", key: "msg", label: "Message", inputs: {} },
          },
        ],
        edges: [],
      },
    });

    const byId = new Map(
      (await orgA.query(api.workflows.list, {})).map((w) => [w._id, w.triggerNodeType]),
    );
    expect(byId.get(named)).toBe("form.trigger");
    expect(byId.get(inferred)).toBe("telegram.message");
  });

  test("list reports the newest run and the recent ones, newest first", async () => {
    const { orgA } = setup();
    const workflowId = await orgA.mutation(api.workflows.create, { name: "Busy" });
    const now = Date.now();

    await orgA.run(async (ctx) => {
      // Inserted oldest first, so the ordering in the answer is the query's doing and not the
      // insertion order's.
      await ctx.db.insert("executions", {
        orgId: "org_1",
        workflowId,
        workflowVersion: 1,
        planSlug: "free_org",
        status: "failed",
        trigger: { type: "manual", payload: {} },
        startedAt: now - 3 * 60_000,
        finishedAt: now - 2 * 60_000,
        error: "Boom",
      });
      await ctx.db.insert("executions", {
        orgId: "org_1",
        workflowId,
        workflowVersion: 1,
        planSlug: "free_org",
        status: "completed",
        trigger: { type: "manual", payload: {} },
        startedAt: now - 60_000,
        finishedAt: now - 30_000,
      });
      // Older than the seven-day window: it still counts as history, never as this week's activity.
      await ctx.db.insert("executions", {
        orgId: "org_1",
        workflowId,
        workflowVersion: 1,
        planSlug: "free_org",
        status: "completed",
        trigger: { type: "manual", payload: {} },
        startedAt: now - 30 * 24 * 60 * 60 * 1000,
        finishedAt: now - 30 * 24 * 60 * 60 * 1000 + 1_000,
      });
    });

    const [summary] = await orgA.query(api.workflows.list, {});

    expect(summary.lastRun).toEqual({
      status: "completed",
      startedAt: now - 60_000,
      finishedAt: now - 30_000,
    });
    expect(summary.recentRuns.map((run) => run.status)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
    expect(summary.recentRuns[0].startedAt).toBeGreaterThan(summary.recentRuns[1].startedAt);
    expect(summary.runCount7d).toBe(2);
  });

  test("list carries the failed run's error and caps the strip at eight", async () => {
    const { orgA } = setup();
    const workflowId = await orgA.mutation(api.workflows.create, { name: "Chatty" });
    const now = Date.now();

    await orgA.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        await ctx.db.insert("executions", {
          orgId: "org_1",
          workflowId,
          workflowVersion: 1,
          planSlug: "free_org",
          status: i === 11 ? "failed" : "completed",
          trigger: { type: "manual", payload: {} },
          startedAt: now - (12 - i) * 60_000,
          finishedAt: now - (12 - i) * 60_000 + 500,
          ...(i === 11 ? { error: "Slack said no" } : {}),
        });
      }
    });

    const [summary] = await orgA.query(api.workflows.list, {});

    expect(summary.lastRun?.status).toBe("failed");
    expect(summary.lastRun?.error).toBe("Slack said no");
    expect(summary.recentRuns).toHaveLength(8);
    expect(summary.runCount7d).toBe(12);
  });

  test("create refuses once the org is at its plan's workflow limit", async () => {
    const { orgA } = setup();
    const limit = PLAN_LIMITS.free_org.workflows;

    for (let i = 0; i < limit; i++) {
      await orgA.mutation(api.workflows.create, { name: `Flow ${i}` });
    }

    const data = await convexErrorData(
      orgA.mutation(api.workflows.create, { name: "One too many" }),
    );
    expect(data).toEqual({ code: "plan_limit", limit });

    // The refused create wrote nothing.
    expect(await orgA.query(api.workflows.list, {})).toHaveLength(limit);
  });

  test("saveGraph bumps the version and records who edited it", async () => {
    const { orgA } = setup();
    const id = await orgA.mutation(api.workflows.create, { name: "Flow" });
    const before = await orgA.query(api.workflows.get, { id });

    const graph = {
      nodes: [{ id: "n1", type: "papaflow", position: { x: 0, y: 0 }, data: { nodeType: "manual.trigger" } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      triggerId: "n1",
    };
    const result = await orgA.mutation(api.workflows.saveGraph, {
      id,
      graph,
      expectedVersion: 1,
    });

    expect(result).toEqual({ version: 2 });

    const after = await orgA.query(api.workflows.get, { id });
    expect(after.version).toBe(2);
    expect(after.graph).toEqual(graph);
    expect(after.lastEditSource).toBe("canvas");
    expect(after.lastEditedBy).toBe("user_1");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);

    // Saving again with the version we were handed back keeps working.
    expect(
      await orgA.mutation(api.workflows.saveGraph, {
        id,
        graph: { nodes: [], edges: [] },
        expectedVersion: 2,
      }),
    ).toEqual({ version: 3 });
  });

  test("saveGraph rejects a stale expectedVersion and leaves the graph alone", async () => {
    const { orgA } = setup();
    const id = await orgA.mutation(api.workflows.create, { name: "Flow" });
    await orgA.mutation(api.workflows.saveGraph, {
      id,
      graph: { nodes: [{ id: "n1" }], edges: [] },
      expectedVersion: 1,
    });

    const data = await convexErrorData(
      orgA.mutation(api.workflows.saveGraph, {
        id,
        graph: { nodes: [], edges: [] },
        expectedVersion: 1,
      }),
    );
    expect(data).toEqual({ code: "version_conflict", version: 2 });

    const doc = await orgA.query(api.workflows.get, { id });
    expect(doc.version).toBe(2);
    expect(doc.graph.nodes).toHaveLength(1);
  });

  test("rename and remove", async () => {
    const { orgA } = setup();
    const id = await orgA.mutation(api.workflows.create, { name: "Old name" });

    await orgA.mutation(api.workflows.rename, { id, name: "New name" });
    expect((await orgA.query(api.workflows.get, { id })).name).toBe("New name");
    // Renaming does not touch the graph version.
    expect((await orgA.query(api.workflows.get, { id })).version).toBe(1);

    await orgA.mutation(api.workflows.remove, { id });
    expect(await orgA.query(api.workflows.list, {})).toEqual([]);
    expect(await convexErrorData(orgA.query(api.workflows.get, { id }))).toEqual({
      code: "not_found",
    });
  });

  test("setStatus publishes and unpublishes without touching the graph version", async () => {
    const { orgA } = setup();
    const id = await orgA.mutation(api.workflows.create, { name: "Contact form" });
    expect((await orgA.query(api.workflows.get, { id })).status).toBe("draft");

    await orgA.mutation(api.workflows.setStatus, { id, status: "active" });
    const published = await orgA.query(api.workflows.get, { id });
    expect(published.status).toBe("active");
    // Publishing is not a graph edit: no canvas has a conflict to resolve.
    expect(published.version).toBe(1);
    expect(published.updatedAt).toBeGreaterThan(0);

    // "Unpublish" is `paused`, never back to `draft`: the list still shows it was published once.
    await orgA.mutation(api.workflows.setStatus, { id, status: "paused" });
    expect((await orgA.query(api.workflows.get, { id })).status).toBe("paused");

    // And the summary the list renders reports it.
    const [summary] = await orgA.query(api.workflows.list, {});
    expect(summary.status).toBe("paused");
  });

  test("a second organisation cannot publish org_1's workflow", async () => {
    const { orgA, orgB } = setup();
    const id = await orgA.mutation(api.workflows.create, { name: "Private" });

    expect(
      await convexErrorData(orgB.mutation(api.workflows.setStatus, { id, status: "active" })),
    ).toEqual({ code: "not_found" });

    // It is still a draft, so none of its triggers are listening.
    expect((await orgA.query(api.workflows.get, { id })).status).toBe("draft");
  });

  test("a second organisation cannot read or write org_1's workflow", async () => {
    const { orgA, orgB } = setup();
    const id = await orgA.mutation(api.workflows.create, { name: "Private" });

    const notFound = { code: "not_found" };
    expect(await convexErrorData(orgB.query(api.workflows.get, { id }))).toEqual(notFound);
    expect(
      await convexErrorData(
        orgB.mutation(api.workflows.saveGraph, {
          id,
          graph: { nodes: [], edges: [] },
          expectedVersion: 1,
        }),
      ),
    ).toEqual(notFound);
    expect(
      await convexErrorData(orgB.mutation(api.workflows.rename, { id, name: "Stolen" })),
    ).toEqual(notFound);
    expect(await convexErrorData(orgB.mutation(api.workflows.remove, { id }))).toEqual(notFound);

    // …and nothing changed.
    const doc = await orgA.query(api.workflows.get, { id });
    expect(doc.name).toBe("Private");
    expect(doc.version).toBe(1);
  });

  test("a workflow id that does not exist reads as not_found", async () => {
    const { t, orgA } = setup();
    const id = await orgA.mutation(api.workflows.create, { name: "Gone" });
    await t.run(async (ctx) => {
      await ctx.db.delete(id as Id<"workflows">);
    });

    expect(await convexErrorData(orgA.query(api.workflows.get, { id }))).toEqual({
      code: "not_found",
    });
  });

  test("every function requires a signed-in user with an active organisation", async () => {
    const { t } = setup();
    const noOrg = t.withIdentity({ subject: "user_1", issuer: ISSUER });

    await expect(t.query(api.workflows.list, {})).rejects.toThrow(/unauthenticated/);
    await expect(t.mutation(api.workflows.create, { name: "Nope" })).rejects.toThrow(
      /unauthenticated/,
    );
    await expect(noOrg.query(api.workflows.list, {})).rejects.toThrow(/no active organization/);
    await expect(noOrg.mutation(api.workflows.create, { name: "Nope" })).rejects.toThrow(
      /no active organization/,
    );
  });
});
