import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";

import { FEATURES, PLAN_LIMITS } from "../lib/plans";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";
import { monthKey } from "./usage";

/**
 * Phase 11's plan walls, end to end through Convex: the workflow cap, the monthly run cap, the
 * usage the settings page reads, and how far back a plan can see its run history.
 *
 * Every one of them is keyed on what Clerk put on the session token — `pla`/`fea` for a signed-in
 * caller, `executions.planSlug` for the engine — because nothing about plans is mirrored in Convex
 * (CLAUDE.md rule 10). So a test upgrades an org by handing it a different claim, not by writing
 * a row.
 */

process.env.ENGINE_SECRET = "test-secret";

const SECRET = "test-secret";
const ISSUER = "https://x.clerk.accounts.dev";
const ORG = "org_1";
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Clerk v2 session identity as Convex exposes it. No `pla` claim means `free_org`. */
function identity(plan?: "pro" | "team") {
  if (!plan) return { subject: "user_1", issuer: ISSUER, org_id: ORG };
  return {
    subject: "user_1",
    issuer: ISSUER,
    org_id: ORG,
    pla: `o:${plan}`,
    fea: FEATURES[plan].map((feature) => `o:${feature}`).join(","),
  };
}

function setup() {
  const t = convexTest(schema, modules);
  return { t, free: t.withIdentity(identity()), pro: t.withIdentity(identity("pro")) };
}

async function convexErrorData(promise: Promise<unknown>) {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(ConvexError);
  return (thrown as ConvexError<Record<string, Value>>).data;
}

/** The engine's own entry point: no session, the plan carried as an argument. */
async function startRun(
  t: ReturnType<typeof convexTest>,
  workflowId: Id<"workflows">,
  planSlug: string,
) {
  return await t.mutation(api.engine.createExecution, {
    secret: SECRET,
    orgId: ORG,
    workflowId,
    workflowVersion: 1,
    planSlug,
    trigger: { type: "manual", payload: {} },
  });
}

describe("workflow limit", () => {
  test("free_org gets three workflows and is refused the fourth", async () => {
    const { free } = setup();
    const limit = PLAN_LIMITS.free_org.workflows;
    expect(limit).toBe(3);

    for (let i = 0; i < limit; i++) {
      await free.mutation(api.workflows.create, { name: `Flow ${i}` });
    }

    expect(
      await convexErrorData(free.mutation(api.workflows.create, { name: "Fourth" })),
    ).toEqual({ code: "plan_limit", limit });

    // Refused, not partially applied: the org still has exactly its three.
    expect(await free.query(api.workflows.list, {})).toHaveLength(limit);
  });

  test("pro has no workflow cap, on the same rows the free plan was refused for", async () => {
    const { free, pro } = setup();

    for (let i = 0; i < PLAN_LIMITS.free_org.workflows; i++) {
      await free.mutation(api.workflows.create, { name: `Flow ${i}` });
    }

    // Same org, same rows — only the `pla` claim differs, which is the whole gate.
    await pro.mutation(api.workflows.create, { name: "Fourth" });
    await pro.mutation(api.workflows.create, { name: "Fifth" });
    expect(await pro.query(api.workflows.list, {})).toHaveLength(5);
  });
});

describe("monthly run limit", () => {
  test("free_org gets 100 runs a month and is refused the 101st", async () => {
    const { t, free } = setup();
    const limit = PLAN_LIMITS.free_org.runsPerMonth;
    expect(limit).toBe(100);

    const workflowId = await free.mutation(api.workflows.create, { name: "Flow" });

    // 100 runs is a lot of transactions; seed the counter to one short of the wall instead.
    await t.run(async (ctx) => {
      await ctx.db.insert("usage", {
        orgId: ORG,
        month: monthKey(),
        runs: limit - 1,
        builderTurns: 0,
        houseModelCalls: 0,
      });
    });

    // The hundredth is fine…
    await startRun(t, workflowId, "free_org");
    expect((await free.query(api.usage.current, {})).runs).toBe(limit);

    // …the hundred-and-first is not, and leaves no execution behind.
    expect(await convexErrorData(startRun(t, workflowId, "free_org"))).toEqual({
      code: "run_limit",
      limit,
    });
    expect((await free.query(api.usage.current, {})).runs).toBe(limit);
    expect((await free.query(api.executions.listByWorkflow, { workflowId })).runs).toHaveLength(1);
  });

  test("pro runs past the free allowance, judged on the execution's own plan snapshot", async () => {
    const { t, free, pro } = setup();
    const workflowId = await free.mutation(api.workflows.create, { name: "Flow" });

    await t.run(async (ctx) => {
      await ctx.db.insert("usage", {
        orgId: ORG,
        month: monthKey(),
        runs: PLAN_LIMITS.free_org.runsPerMonth,
        builderTurns: 0,
        houseModelCalls: 0,
      });
    });

    // The engine has no session: `planSlug` is what it read from Clerk at run start.
    await startRun(t, workflowId, "pro");

    const usage = await pro.query(api.usage.current, {});
    expect(usage.runs).toBe(PLAN_LIMITS.free_org.runsPerMonth + 1);
    expect(usage.limits.runsPerMonth).toBe(PLAN_LIMITS.pro.runsPerMonth);
  });
});

describe("api.usage.current", () => {
  test("reports this month's runs and the workflow count against the caller's plan", async () => {
    const { t, free, pro } = setup();

    const empty = await free.query(api.usage.current, {});
    expect(empty).toEqual({
      month: monthKey(),
      runs: 0,
      workflows: 0,
      plan: "free_org",
      limits: {
        runsPerMonth: PLAN_LIMITS.free_org.runsPerMonth,
        workflows: PLAN_LIMITS.free_org.workflows,
      },
    });

    const workflowId = await free.mutation(api.workflows.create, { name: "Flow" });
    await startRun(t, workflowId, "free_org");
    await startRun(t, workflowId, "free_org");

    expect(await free.query(api.usage.current, {})).toMatchObject({ runs: 2, workflows: 1 });

    // `Infinity` cannot cross the wire, so an unlimited allowance arrives as null.
    expect(await pro.query(api.usage.current, {})).toMatchObject({
      plan: "pro",
      limits: { runsPerMonth: PLAN_LIMITS.pro.runsPerMonth, workflows: null },
    });
  });

  test("counts only the caller's own organisation", async () => {
    const { t, free } = setup();
    const other = t.withIdentity({ subject: "user_2", issuer: ISSUER, org_id: "org_2" });

    await free.mutation(api.workflows.create, { name: "Mine" });
    await other.mutation(api.workflows.create, { name: "Theirs" });

    expect((await free.query(api.usage.current, {})).workflows).toBe(1);
    expect((await other.query(api.usage.current, {})).workflows).toBe(1);
  });
});

describe("run history window", () => {
  /** Three runs: today, 10 days ago and 40 days ago. */
  async function seedHistory(t: ReturnType<typeof convexTest>, workflowId: Id<"workflows">) {
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const ageDays of [0, 10, 40]) {
        await ctx.db.insert("executions", {
          orgId: ORG,
          workflowId,
          workflowVersion: 1,
          planSlug: "free_org",
          status: "completed",
          trigger: { type: "manual", payload: { ageDays } },
          startedAt: now - ageDays * DAY_MS,
        });
      }
    });
  }

  test("free_org sees 7 days and is told there is more", async () => {
    const { t, free } = setup();
    const workflowId = await free.mutation(api.workflows.create, { name: "Flow" });
    await seedHistory(t, workflowId);

    const byWorkflow = await free.query(api.executions.listByWorkflow, { workflowId });
    expect(byWorkflow.windowDays).toBe(7);
    expect(byWorkflow.runs).toHaveLength(1);
    expect(byWorkflow.clipped).toBe(true);

    const byOrg = await free.query(api.executions.listByOrg, {});
    expect(byOrg.windowDays).toBe(7);
    expect(byOrg.runs).toHaveLength(1);
    expect(byOrg.clipped).toBe(true);
    expect(byOrg.workflowNames).toEqual({ [workflowId]: "Flow" });
  });

  test("run_history_30d widens the window to 30 days", async () => {
    const { t, free, pro } = setup();
    const workflowId = await free.mutation(api.workflows.create, { name: "Flow" });
    await seedHistory(t, workflowId);

    const byWorkflow = await pro.query(api.executions.listByWorkflow, { workflowId });
    expect(byWorkflow.windowDays).toBe(30);
    expect(byWorkflow.runs).toHaveLength(2);
    // The 40-day-old run is still older than even the wide window.
    expect(byWorkflow.clipped).toBe(true);

    const byOrg = await pro.query(api.executions.listByOrg, {});
    expect(byOrg.windowDays).toBe(30);
    expect(byOrg.runs).toHaveLength(2);
    expect(byOrg.clipped).toBe(true);
  });

  test("nothing is clipped when every run is inside the window", async () => {
    const { t, free } = setup();
    const workflowId = await free.mutation(api.workflows.create, { name: "Flow" });
    await startRun(t, workflowId, "free_org");

    expect(await free.query(api.executions.listByWorkflow, { workflowId })).toMatchObject({
      windowDays: 7,
      clipped: false,
    });
    expect(await free.query(api.executions.listByOrg, {})).toMatchObject({
      windowDays: 7,
      clipped: false,
    });
  });

  test("listByOrg never leaks another organisation's runs", async () => {
    const { t, free } = setup();
    const other = t.withIdentity({ subject: "user_2", issuer: ISSUER, org_id: "org_2" });

    const mine = await free.mutation(api.workflows.create, { name: "Mine" });
    await startRun(t, mine, "free_org");

    expect((await free.query(api.executions.listByOrg, {})).runs).toHaveLength(1);
    expect((await other.query(api.executions.listByOrg, {})).runs).toHaveLength(0);
  });
});
