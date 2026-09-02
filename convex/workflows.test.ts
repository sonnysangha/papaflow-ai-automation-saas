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
    });
    // The list projection never leaks the webhook secret or the graph.
    expect(list[0]).not.toHaveProperty("webhookSecret");
    expect(list[0]).not.toHaveProperty("graph");

    expect((await orgB.query(api.workflows.list, {})).map((w) => w.name)).toEqual(["Not mine"]);
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
