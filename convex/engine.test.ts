import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";

import { PLAN_LIMITS } from "../lib/plans";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { monthKey } from "./usage";

// `guard()` reads process.env at call time, so this only has to be set before the first function
// call — but it is set here, before any `convexTest` instance exists, so nothing can race it.
process.env.ENGINE_SECRET = "test-secret";

const SECRET = "test-secret";
const ISSUER = "https://x.clerk.accounts.dev";
const ORG = "org_1";

/** The engine has no Clerk session: it calls the public functions with the shared secret only. */
async function setup() {
  const t = convexTest(schema, modules);
  const orgA = t.withIdentity({ subject: "user_1", issuer: ISSUER, org_id: ORG });
  const orgB = t.withIdentity({ subject: "user_2", issuer: ISSUER, org_id: "org_2" });
  const workflowId = await orgA.mutation(api.workflows.create, { name: "Flow" });
  return { t, orgA, orgB, workflowId };
}

type Engine = Awaited<ReturnType<typeof setup>>;

async function createExecution(
  { t, workflowId }: Pick<Engine, "t" | "workflowId">,
  overrides: { orgId?: string; planSlug?: string } = {},
) {
  return await t.mutation(api.engine.createExecution, {
    secret: SECRET,
    orgId: overrides.orgId ?? ORG,
    workflowId,
    workflowVersion: 1,
    planSlug: overrides.planSlug ?? "free_org",
    trigger: { type: "manual", payload: { hello: "world" } },
    startedBy: "user_1",
  });
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

describe("api.engine", () => {
  test("every engine function refuses a wrong or missing secret", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });
    const unauthorized = { code: "unauthorized" };

    expect(
      await convexErrorData(
        t.mutation(api.engine.markStep, {
          secret: "not-the-secret",
          executionId,
          orgId: ORG,
          nodeId: "n1",
          nodeType: "http.request",
          status: "running",
          attempt: 1,
        }),
      ),
    ).toEqual(unauthorized);

    expect(
      await convexErrorData(
        t.query(api.engine.getWorkflowForRun, { secret: "", workflowId, orgId: ORG }),
      ),
    ).toEqual(unauthorized);

    expect(
      await convexErrorData(
        createExecution({ t, workflowId: workflowId }).then(() =>
          t.mutation(api.engine.createExecution, {
            secret: "nope",
            orgId: ORG,
            workflowId,
            workflowVersion: 1,
            planSlug: "free_org",
            trigger: { type: "manual", payload: {} },
          }),
        ),
      ),
    ).toEqual(unauthorized);

    expect(
      await convexErrorData(
        t.mutation(api.engine.finishExecution, {
          secret: "nope",
          executionId,
          status: "completed",
        }),
      ),
    ).toEqual(unauthorized);

    // The refused calls wrote nothing.
    await t.run(async (ctx) => {
      expect(await ctx.db.query("steps").collect()).toHaveLength(0);
      expect((await ctx.db.get(executionId))?.status).toBe("queued");
    });
  });

  test("getWorkflowForRun returns the graph for the owning org and null for any other", async () => {
    const { t, orgA, workflowId } = await setup();
    const graph = { nodes: [{ id: "n1" }], edges: [], triggerId: "n1" };
    await orgA.mutation(api.workflows.saveGraph, { id: workflowId, graph, expectedVersion: 1 });

    const wf = await t.query(api.engine.getWorkflowForRun, { secret: SECRET, workflowId, orgId: ORG });
    expect(wf).toEqual({
      graph,
      version: 2,
      name: "Flow",
      // Read by `fireSchedule`, which is the one trigger with nowhere else to ask.
      status: "draft",
      webhookSecret: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
    });

    expect(
      await t.query(api.engine.getWorkflowForRun, { secret: SECRET, workflowId, orgId: "org_2" }),
    ).toBeNull();
  });

  test("the public trigger surface reports publish state, and lists published workflows only", async () => {
    const { t, orgA, workflowId } = await setup();
    await orgA.mutation(api.workflows.saveGraph, {
      id: workflowId,
      expectedVersion: 1,
      graph: {
        nodes: [
          { id: "n1", data: { nodeType: "webhook.trigger", inputs: {} } },
          { id: "n2", data: { nodeType: "form.trigger", inputs: { title: "Contact us" } } },
          { id: "n3", data: { nodeType: "telegram.message", inputs: { connectionId: "conn_1" } } },
        ],
        edges: [],
        triggerId: "n1",
      },
    });

    const publicArgs = { secret: SECRET, workflowId };
    const byTrigger = {
      secret: SECRET,
      orgId: ORG,
      triggerType: "telegram.message",
      connectionId: "conn_1",
    };

    // A draft: the webhook and form routes are told so and refuse with a message, while an inbound
    // delivery — which has nobody to explain a refusal to — simply finds nothing listening.
    expect((await t.query(api.engine.getWorkflowPublic, publicArgs))?.status).toBe("draft");
    expect((await t.query(api.engine.getPublicForm, publicArgs))?.status).toBe("draft");
    expect(await t.query(api.engine.listWorkflowsByTrigger, byTrigger)).toEqual([]);

    await orgA.mutation(api.workflows.setStatus, { id: workflowId, status: "active" });

    expect((await t.query(api.engine.getWorkflowPublic, publicArgs))?.status).toBe("active");
    expect((await t.query(api.engine.getPublicForm, publicArgs))?.status).toBe("active");
    expect(await t.query(api.engine.listWorkflowsByTrigger, byTrigger)).toEqual([
      { _id: workflowId, orgId: ORG, name: "Flow" },
    ]);

    await orgA.mutation(api.workflows.setStatus, { id: workflowId, status: "paused" });
    expect(await t.query(api.engine.listWorkflowsByTrigger, byTrigger)).toEqual([]);
  });

  test("createExecution snapshots the plan and counts one run for the month", async () => {
    const { t, workflowId } = await setup();

    const executionId = await createExecution({ t, workflowId }, { planSlug: "pro" });

    await t.run(async (ctx) => {
      const execution = await ctx.db.get(executionId);
      expect(execution).toMatchObject({
        orgId: ORG,
        workflowId,
        workflowVersion: 1,
        planSlug: "pro",
        status: "queued",
        startedBy: "user_1",
        trigger: { type: "manual", payload: { hello: "world" } },
      });
      expect(execution?.startedAt).toBeGreaterThan(0);
      expect(execution?.finishedAt).toBeUndefined();

      const usage = await ctx.db.query("usage").collect();
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ orgId: ORG, month: monthKey(), runs: 1 });
    });

    await createExecution({ t, workflowId });
    await t.run(async (ctx) => {
      const usage = await ctx.db.query("usage").collect();
      expect(usage).toHaveLength(1);
      expect(usage[0].runs).toBe(2);
    });
  });

  test("createExecution refuses once the org is at its plan's monthly run limit", async () => {
    const { t, workflowId } = await setup();
    const limit = PLAN_LIMITS.free_org.runsPerMonth;

    await t.run(async (ctx) => {
      await ctx.db.insert("usage", {
        orgId: ORG,
        month: monthKey(),
        runs: limit,
        builderTurns: 0,
        houseModelCalls: 0,
      });
    });

    expect(await convexErrorData(createExecution({ t, workflowId }))).toEqual({
      code: "run_limit",
      limit,
    });

    // The refused run wrote no execution and did not move the counter.
    await t.run(async (ctx) => {
      expect(await ctx.db.query("executions").collect()).toHaveLength(0);
      expect((await ctx.db.query("usage").collect())[0].runs).toBe(limit);
    });

    // An unlimited plan (`Infinity` runs) still counts, and never refuses.
    await t.run(async (ctx) => {
      await ctx.db.insert("usage", {
        orgId: "org_unlimited",
        month: monthKey(),
        runs: 10_000,
        builderTurns: 0,
        houseModelCalls: 0,
      });
    });
    await createExecution({ t, workflowId }, { orgId: "org_unlimited", planSlug: "team" });
    await t.run(async (ctx) => {
      const usage = await ctx.db
        .query("usage")
        .withIndex("by_org_month", (q) => q.eq("orgId", "org_unlimited").eq("month", monthKey()))
        .unique();
      expect(usage?.runs).toBe(10_001);
    });
  });

  test("markStep inserts the first time and patches the same row afterwards", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "n2",
      nodeType: "http.request",
      status: "running",
      attempt: 1,
    });

    const running = await t.query(api.engine.getStep, { secret: SECRET, executionId, nodeId: "n2" });
    expect(running).toMatchObject({ status: "running", attempt: 1, nodeType: "http.request" });
    expect(running?.finishedAt).toBeUndefined();

    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "n2",
      nodeType: "http.request",
      status: "success",
      attempt: 1,
      input: { url: "https://example.com", token: "••••" },
      output: { status: 200 },
      handle: "true",
    });

    const rows = await t.run(async (ctx) => await ctx.db.query("steps").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      executionId,
      orgId: ORG,
      nodeId: "n2",
      status: "success",
      attempt: 1,
      input: { url: "https://example.com", token: "••••" },
      output: { status: 200 },
      handle: "true",
    });
    // `startedAt` survives the patch; `finishedAt` only lands on a terminal status.
    expect(rows[0].startedAt).toBe(running?.startedAt);
    expect(rows[0].finishedAt).toBeGreaterThanOrEqual(rows[0].startedAt);

    // A retry puts the same row back to running and clears the stale finishedAt.
    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "n2",
      nodeType: "http.request",
      status: "running",
      attempt: 2,
    });
    const retried = await t.run(async (ctx) => await ctx.db.query("steps").collect());
    expect(retried).toHaveLength(1);
    expect(retried[0]).toMatchObject({ status: "running", attempt: 2 });
    expect(retried[0].finishedAt).toBeUndefined();
    // …and keeps what the successful attempt stored until the new one overwrites it.
    expect(retried[0].output).toEqual({ status: 200 });
  });

  test("a loop body node gets one row per pass, and getStep addresses them separately", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    // Three passes of the same node, exactly as `runNode` writes them inside a Loop.
    for (const iteration of [0, 1, 2]) {
      await t.mutation(api.engine.markStep, {
        secret: SECRET,
        executionId,
        orgId: ORG,
        nodeId: "body",
        nodeType: "logic.set",
        status: "success",
        attempt: 1,
        output: { item: iteration },
        iteration,
      });
    }

    const rows = await t.run(async (ctx) => await ctx.db.query("steps").collect());
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.iteration)).toEqual([0, 1, 2]);

    // Each pass is its own address: this is what stops `runNode`'s guard from handing pass 2 the
    // answer pass 1 stored.
    const second = await t.query(api.engine.getStep, {
      secret: SECRET,
      executionId,
      nodeId: "body",
      iteration: 1,
    });
    expect(second).toMatchObject({ status: "success", output: { item: 1 }, iteration: 1 });

    // …and a pass that has not happened yet has no row, however many earlier ones there are.
    expect(
      await t.query(api.engine.getStep, {
        secret: SECRET,
        executionId,
        nodeId: "body",
        iteration: 3,
      }),
    ).toBeNull();

    // The same pass marked again patches its own row rather than adding a fourth.
    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "body",
      nodeType: "logic.set",
      status: "running",
      attempt: 2,
      iteration: 1,
    });
    const patched = await t.run(async (ctx) => await ctx.db.query("steps").collect());
    expect(patched).toHaveLength(3);
    expect(patched.find((row) => row.iteration === 1)).toMatchObject({
      status: "running",
      attempt: 2,
    });
  });

  test("a node without an iteration is a different row from any of its passes", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    for (const iteration of [undefined, 0]) {
      await t.mutation(api.engine.markStep, {
        secret: SECRET,
        executionId,
        orgId: ORG,
        nodeId: "n2",
        nodeType: "http.request",
        status: "success",
        attempt: 1,
        output: { iteration: iteration ?? null },
        iteration,
      });
    }

    const rows = await t.run(async (ctx) => await ctx.db.query("steps").collect());
    expect(rows).toHaveLength(2);

    // Asking without one means "the row for a node that runs once", not "the first row".
    const once = await t.query(api.engine.getStep, { secret: SECRET, executionId, nodeId: "n2" });
    expect(once).toMatchObject({ output: { iteration: null } });
    expect(once?.iteration).toBeUndefined();
  });

  test("markSkipped leaves a node alone when any pass of it ran", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "body",
      nodeType: "logic.set",
      status: "success",
      attempt: 1,
      iteration: 0,
    });

    await t.mutation(api.engine.markSkipped, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeIds: ["body", "never"],
    });

    const rows = await t.run(async (ctx) => await ctx.db.query("steps").collect());
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.nodeId === "body")?.status).toBe("success");
    expect(rows.find((row) => row.nodeId === "never")?.status).toBe("skipped");
  });

  test("getStep is null before the first mark, and markStep is scoped to the execution's org", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    expect(
      await t.query(api.engine.getStep, { secret: SECRET, executionId, nodeId: "nope" }),
    ).toBeNull();

    expect(
      await convexErrorData(
        t.mutation(api.engine.markStep, {
          secret: SECRET,
          executionId,
          orgId: "org_2",
          nodeId: "n2",
          nodeType: "http.request",
          status: "running",
          attempt: 1,
        }),
      ),
    ).toEqual({ code: "not_found" });
  });

  test("markStep stores the hook token on a waiting step, and getStepByHookToken finds it", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });
    const token = `${executionId}:approval_1`;

    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "approval_1",
      nodeType: "logic.waitForWebhook",
      status: "waiting",
      attempt: 1,
      output: { body: null, headers: {} },
      hookToken: token,
    });

    // `waiting` is not terminal: the row stays open until the payload arrives.
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("steps").collect();
      expect(row.hookToken).toBe(token);
      expect(row.finishedAt).toBeUndefined();
    });

    const found = await t.query(api.engine.getStepByHookToken, { secret: SECRET, hookToken: token });
    expect(found).toEqual({
      _id: expect.anything(),
      executionId,
      orgId: ORG,
      nodeId: "approval_1",
      nodeType: "logic.waitForWebhook",
      status: "waiting",
    });
    // Ids and status only: a resume route holds nothing but the token, so it learns nothing else.
    expect(Object.keys(found ?? {}).sort()).toEqual([
      "_id",
      "executionId",
      "nodeId",
      "nodeType",
      "orgId",
      "status",
    ]);
  });

  test("getStepByHookToken is null for an unissued token, and reports a step that stopped waiting", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });
    const token = `${executionId}:wait_1`;

    expect(
      await t.query(api.engine.getStepByHookToken, { secret: SECRET, hookToken: token }),
    ).toBeNull();

    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "wait_1",
      nodeType: "logic.waitForWebhook",
      status: "waiting",
      attempt: 1,
      hookToken: token,
    });

    // The resume: `recordResume` marks the same row `success` with the payload as its output and
    // does not send a token, which must not wipe the one already on the row.
    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "wait_1",
      nodeType: "logic.waitForWebhook",
      status: "success",
      attempt: 1,
      output: { body: { ok: true }, headers: {} },
      handle: "approved",
    });

    // Still findable by token — `lib/hooks.ts#resumeByToken` refuses it on status, not absence, so
    // a second POST to the same URL is a flat 404 rather than a second resume.
    const resumed = await t.query(api.engine.getStepByHookToken, {
      secret: SECRET,
      hookToken: token,
    });
    expect(resumed).toMatchObject({ nodeId: "wait_1", status: "success" });
  });

  test("getStepByHookToken refuses a wrong secret", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    expect(
      await convexErrorData(
        t.query(api.engine.getStepByHookToken, {
          secret: "not-the-secret",
          hookToken: `${executionId}:wait_1`,
        }),
      ),
    ).toEqual({ code: "unauthorized" });
  });

  test("getStepById turns an Approval button's callback id back into a resumable step", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });
    const token = `${executionId}:approval_1:2`;

    // `markStep` hands back the row id, which is exactly what the node puts in its buttons.
    const stepId = await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "approval_1",
      nodeType: "logic.approval",
      status: "waiting",
      attempt: 1,
      output: { posted: true, provider: "slack" },
      hookToken: token,
      iteration: 2,
    });

    const found = await t.query(api.engine.getStepById, { secret: SECRET, stepId });
    expect(found).toEqual({
      _id: stepId,
      executionId,
      orgId: ORG,
      nodeId: "approval_1",
      nodeType: "logic.approval",
      status: "waiting",
      iteration: 2,
      hookToken: token,
    });
    // Ids and status only: a resume route has proved a provider signature, not a right to read the
    // run's data, so the node's `input` and `output` never leave through here (CLAUDE.md rule 1).
    expect(Object.keys(found ?? {}).sort()).toEqual([
      "_id",
      "executionId",
      "hookToken",
      "iteration",
      "nodeId",
      "nodeType",
      "orgId",
      "status",
    ]);

    expect(
      await convexErrorData(t.query(api.engine.getStepById, { secret: "not-the-secret", stepId })),
    ).toEqual({ code: "unauthorized" });
  });

  test("setExecutionStatus moves a run in and out of waiting, and never reopens a finished one", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    const statusOf = async () => (await t.run(async (ctx) => ctx.db.get(executionId)))?.status;

    await t.mutation(api.engine.setExecutionStatus, { secret: SECRET, executionId, status: "waiting" });
    expect(await statusOf()).toBe("waiting");

    await t.mutation(api.engine.setExecutionStatus, { secret: SECRET, executionId, status: "running" });
    expect(await statusOf()).toBe("running");

    await t.mutation(api.engine.finishExecution, { secret: SECRET, executionId, status: "completed" });

    // A record step that lands after the run ended must not resurrect it.
    await t.mutation(api.engine.setExecutionStatus, { secret: SECRET, executionId, status: "waiting" });
    expect(await statusOf()).toBe("completed");

    expect(
      await convexErrorData(
        t.mutation(api.engine.setExecutionStatus, {
          secret: "not-the-secret",
          executionId,
          status: "waiting",
        }),
      ),
    ).toEqual({ code: "unauthorized" });
  });

  test("markSkipped only writes rows for nodes that never ran", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    await t.mutation(api.engine.markStep, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeId: "ran",
      nodeType: "http.request",
      status: "success",
      attempt: 1,
    });

    await t.mutation(api.engine.markSkipped, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeIds: ["ran", "skipped_a", "skipped_b"],
    });
    // Running it twice (a replayed step) must not duplicate rows.
    await t.mutation(api.engine.markSkipped, {
      secret: SECRET,
      executionId,
      orgId: ORG,
      nodeIds: ["ran", "skipped_a", "skipped_b"],
    });

    const rows = await t.run(async (ctx) => await ctx.db.query("steps").collect());
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === "skipped").map((r) => r.nodeId).sort()).toEqual([
      "skipped_a",
      "skipped_b",
    ]);
    expect(rows.find((r) => r.nodeId === "ran")?.status).toBe("success");
  });

  test("setRunId records the run id and promotes the execution to running", async () => {
    const { t, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    await t.mutation(api.engine.setRunId, { secret: SECRET, executionId, runId: "run_123" });

    await t.run(async (ctx) => {
      const execution = await ctx.db.get(executionId);
      expect(execution?.runId).toBe("run_123");
      expect(execution?.status).toBe("running");
    });
  });

  test("finishExecution sets status, finishedAt and the error message", async () => {
    const { t, workflowId } = await setup();
    const completed = await createExecution({ t, workflowId });
    const failed = await createExecution({ t, workflowId });

    await t.mutation(api.engine.finishExecution, {
      secret: SECRET,
      executionId: completed,
      status: "completed",
    });
    await t.mutation(api.engine.finishExecution, {
      secret: SECRET,
      executionId: failed,
      status: "failed",
      error: "HTTP 500 from https://example.com",
    });

    await t.run(async (ctx) => {
      const ok = await ctx.db.get(completed);
      expect(ok?.status).toBe("completed");
      expect(ok?.finishedAt).toBeGreaterThanOrEqual(ok!.startedAt);
      expect(ok?.error).toBeUndefined();

      const bad = await ctx.db.get(failed);
      expect(bad?.status).toBe("failed");
      expect(bad?.error).toBe("HTTP 500 from https://example.com");
      expect(bad?.finishedAt).toBeGreaterThan(0);
    });
  });
});

describe("api.steps / api.executions (org-gated reads)", () => {
  test("byExecution returns the run's steps to its own org and throws for anyone else", async () => {
    const { t, orgA, orgB, workflowId } = await setup();
    const executionId = await createExecution({ t, workflowId });

    for (const nodeId of ["n1", "n2"]) {
      await t.mutation(api.engine.markStep, {
        secret: SECRET,
        executionId,
        orgId: ORG,
        nodeId,
        nodeType: "http.request",
        status: "success",
        attempt: 1,
        output: { nodeId },
      });
    }

    const steps = await orgA.query(api.steps.byExecution, { executionId });
    expect(steps.map((s) => s.nodeId)).toEqual(["n1", "n2"]);
    expect(steps[0]).toMatchObject({ status: "success", output: { nodeId: "n1" } });

    expect(await convexErrorData(orgB.query(api.steps.byExecution, { executionId }))).toEqual({
      code: "not_found",
    });
    await expect(t.query(api.steps.byExecution, { executionId })).rejects.toThrow(
      /unauthenticated/,
    );
  });

  test("listByWorkflow is newest first and capped at 50; latestByWorkflow is the newest run", async () => {
    const { t, orgA, orgB, workflowId } = await setup();

    const ids: Id<"executions">[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < 51; i++) {
        ids.push(
          await ctx.db.insert("executions", {
            orgId: ORG,
            workflowId,
            workflowVersion: 1,
            planSlug: "free_org",
            status: "completed",
            trigger: { type: "manual", payload: { i } },
            startedAt: Date.now() + i,
          }),
        );
      }
    });

    const page = await orgA.query(api.executions.listByWorkflow, { workflowId });
    expect(page.runs).toHaveLength(50);
    expect(page.runs[0]._id).toBe(ids[50]);
    expect(page.runs[49]._id).toBe(ids[1]);
    // All 51 were started just now, so nothing falls outside the free plan's 7-day window.
    expect(page.clipped).toBe(false);

    const latest = await orgA.query(api.executions.latestByWorkflow, { workflowId });
    expect(latest?._id).toBe(ids[50]);

    const notFound = { code: "not_found" };
    expect(await convexErrorData(orgB.query(api.executions.listByWorkflow, { workflowId }))).toEqual(
      notFound,
    );
    expect(
      await convexErrorData(orgB.query(api.executions.latestByWorkflow, { workflowId })),
    ).toEqual(notFound);
  });

  test("latestByWorkflow is null while a workflow has never run", async () => {
    const { orgA, workflowId } = await setup();
    expect(await orgA.query(api.executions.latestByWorkflow, { workflowId })).toBeNull();
    expect(await orgA.query(api.executions.listByWorkflow, { workflowId })).toEqual({
      runs: [],
      windowDays: 7,
      clipped: false,
    });
  });
});
