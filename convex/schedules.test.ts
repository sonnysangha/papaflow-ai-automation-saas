import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";

import { PLAN_LIMITS } from "../lib/plans";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

/**
 * The `schedules` table from both sides: the one query a browser may call (`getForWorkflow`, behind
 * a Clerk session) and the secret-checked engine surface the route and the scheduler steps use.
 *
 * `guard()` reads `process.env` at call time, so this only has to be set before the first call — but
 * it is set here, before any `convexTest` instance exists, so nothing can race it.
 */
process.env.ENGINE_SECRET = "test-secret";

const SECRET = "test-secret";
const ISSUER = "https://x.clerk.accounts.dev";
const ORG = "org_1";
const OTHER_ORG = "org_2";

const HOURLY = "0 * * * *";
const EVERY_TWO_MINUTES = "*/2 * * * *";

function identity(overrides: Record<string, unknown> = {}) {
  return { subject: "user_1", issuer: ISSUER, org_id: ORG, ...overrides };
}

async function setup(claims: Record<string, unknown> = {}) {
  const t = convexTest(schema, modules);
  const orgA = t.withIdentity(identity(claims));
  const orgB = t.withIdentity({ subject: "user_2", issuer: ISSUER, org_id: OTHER_ORG });

  const workflowId = await orgA.mutation(api.workflows.create, { name: "Flow" });
  const otherWorkflowId = await orgB.mutation(api.workflows.create, { name: "Not mine" });

  return { t, orgA, orgB, workflowId, otherWorkflowId };
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

/** The route's half of "enable": write the row, then point it at the run that `start()` returned. */
async function enable(
  t: Awaited<ReturnType<typeof setup>>["t"],
  workflowId: Id<"workflows">,
  overrides: { cron?: string; timezone?: string; nextAt?: number; runId?: string } = {},
) {
  const scheduleId = await t.mutation(api.engine.upsertSchedule, {
    secret: SECRET,
    orgId: ORG,
    workflowId,
    cron: overrides.cron ?? HOURLY,
    timezone: overrides.timezone ?? "UTC",
    enabled: true,
    nextAt: overrides.nextAt ?? 1_800_000,
  });

  await t.mutation(api.engine.setScheduleRunId, {
    secret: SECRET,
    scheduleId,
    orgId: ORG,
    runId: overrides.runId ?? "wrun_first",
  });

  return scheduleId;
}

describe("api.schedules.getForWorkflow", () => {
  test("answers with the plan's minimum and no schedule before one is enabled", async () => {
    const { orgA, workflowId } = await setup();

    expect(await orgA.query(api.schedules.getForWorkflow, { workflowId })).toEqual({
      plan: "free_org",
      minScheduleMinutes: PLAN_LIMITS.free_org.minScheduleMinutes,
      // Publishing is the schedule's switch, so the panel needs the workflow's status too — a fresh
      // workflow is a draft, which is why it reads "publish the workflow to start its schedule".
      status: "draft",
      schedule: null,
    });
  });

  test("reports the workflow's publish status, because that is the schedule's switch", async () => {
    const { t, orgA, workflowId } = await setup();

    await t.run(async (ctx) => {
      await ctx.db.patch(workflowId, { status: "active" });
    });

    expect((await orgA.query(api.schedules.getForWorkflow, { workflowId })).status).toBe("active");
  });

  test("reads the minimum off the session token's plan claim", async () => {
    const { orgA, workflowId } = await setup({ pla: "o:pro" });

    const status = await orgA.query(api.schedules.getForWorkflow, { workflowId });
    expect(status.plan).toBe("pro");
    expect(status.minScheduleMinutes).toBe(PLAN_LIMITS.pro.minScheduleMinutes);
  });

  test("shows the live row once the route has enabled it", async () => {
    const { t, orgA, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: 1_800_000 });

    const status = await orgA.query(api.schedules.getForWorkflow, { workflowId });
    expect(status.schedule).toMatchObject({
      _id: scheduleId,
      cron: HOURLY,
      timezone: "UTC",
      enabled: true,
      runId: "wrun_first",
      nextAt: 1_800_000,
    });
    // The projection is explicit: the row's org never crosses to the client.
    expect(status.schedule).not.toHaveProperty("orgId");
  });

  test("refuses another organisation's workflow the same way as one that does not exist", async () => {
    const { orgA, otherWorkflowId } = await setup();

    expect(
      await convexErrorData(orgA.query(api.schedules.getForWorkflow, { workflowId: otherWorkflowId })),
    ).toEqual({ code: "not_found" });
  });

  test("needs a session with an organisation", async () => {
    const { t, workflowId } = await setup();

    await expect(t.query(api.schedules.getForWorkflow, { workflowId })).rejects.toThrow(
      /unauthenticated/,
    );
    await expect(
      t
        .withIdentity({ subject: "user_3", issuer: ISSUER })
        .query(api.schedules.getForWorkflow, { workflowId }),
    ).rejects.toThrow(/no active organization/);
  });
});

describe("api.engine schedule functions", () => {
  test("every one of them refuses a wrong or missing secret", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);
    const unauthorized = { code: "unauthorized" };

    expect(
      await convexErrorData(t.query(api.engine.getSchedule, { secret: "nope", scheduleId })),
    ).toEqual(unauthorized);
    expect(
      await convexErrorData(
        t.query(api.engine.getScheduleForWorkflow, { secret: "", workflowId, orgId: ORG }),
      ),
    ).toEqual(unauthorized);
    expect(
      await convexErrorData(
        t.mutation(api.engine.upsertSchedule, {
          secret: "nope",
          orgId: ORG,
          workflowId,
          cron: HOURLY,
          enabled: true,
        }),
      ),
    ).toEqual(unauthorized);
    expect(
      await convexErrorData(
        t.mutation(api.engine.setScheduleEnabled, {
          secret: "nope",
          scheduleId,
          orgId: ORG,
          enabled: false,
        }),
      ),
    ).toEqual(unauthorized);
    expect(
      await convexErrorData(
        t.mutation(api.engine.setScheduleRunId, {
          secret: "nope",
          scheduleId,
          orgId: ORG,
          runId: "wrun_x",
        }),
      ),
    ).toEqual(unauthorized);
    expect(
      await convexErrorData(
        t.mutation(api.engine.markScheduleFired, {
          secret: "nope",
          scheduleId,
          orgId: ORG,
          firedAt: 1,
        }),
      ),
    ).toEqual(unauthorized);
  });

  test("upsert writes one row per workflow and updates it in place", async () => {
    const { t, orgA, workflowId } = await setup();

    const first = await enable(t, workflowId);
    const second = await t.mutation(api.engine.upsertSchedule, {
      secret: SECRET,
      orgId: ORG,
      workflowId,
      cron: EVERY_TWO_MINUTES,
      timezone: "Europe/London",
      enabled: true,
    });

    expect(second).toBe(first);

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId: first });
    expect(row).toMatchObject({
      orgId: ORG,
      workflowId,
      cron: EVERY_TWO_MINUTES,
      timezone: "Europe/London",
      enabled: true,
    });
    // A rewrite forgets the previous run: the route has just cancelled it and is about to start
    // another, and a stale id would be cancelled a second time on the next change.
    expect(row?.runId).toBeUndefined();

    // …and the app still sees exactly one schedule for the workflow.
    const status = await orgA.query(api.schedules.getForWorkflow, { workflowId });
    expect(status.schedule?._id).toBe(first);
  });

  test("upsert refuses a workflow that is not the caller's org's", async () => {
    const { t, otherWorkflowId } = await setup();

    expect(
      await convexErrorData(
        t.mutation(api.engine.upsertSchedule, {
          secret: SECRET,
          orgId: ORG,
          workflowId: otherWorkflowId,
          cron: HOURLY,
          enabled: true,
        }),
      ),
    ).toEqual({ code: "not_found" });
  });

  test("getSchedule hands the step the org and workflow it needs to start the run", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);

    expect(await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId })).toMatchObject({
      _id: scheduleId,
      orgId: ORG,
      workflowId,
      cron: HOURLY,
      enabled: true,
      runId: "wrun_first",
    });
  });

  test("getScheduleForWorkflow hides another org's row behind the same null as a missing one", async () => {
    const { t, workflowId, otherWorkflowId } = await setup();
    await enable(t, workflowId);

    expect(
      await t.query(api.engine.getScheduleForWorkflow, {
        secret: SECRET,
        workflowId,
        orgId: OTHER_ORG,
      }),
    ).toBeNull();
    expect(
      await t.query(api.engine.getScheduleForWorkflow, {
        secret: SECRET,
        workflowId: otherWorkflowId,
        orgId: ORG,
      }),
    ).toBeNull();
  });

  test("markScheduleFired claims a tick and records the one after it", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);

    await t.mutation(api.engine.markScheduleFired, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      firedAt: 1_800_000,
      nextAt: 5_400_000,
    });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.lastFiredAt).toBe(1_800_000);
    expect(row?.nextAt).toBe(5_400_000);
    // Firing does not disturb the run doing the firing.
    expect(row?.runId).toBe("wrun_first");
  });

  test("setScheduleRunId follows the run across a continue-as-new", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);

    await t.mutation(api.engine.setScheduleRunId, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      runId: "wrun_second",
    });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.runId).toBe("wrun_second");
  });

  test("pausing clears the run the route has just cancelled, and its next fire time", async () => {
    const { t, orgA, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);

    await t.mutation(api.engine.setScheduleEnabled, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      enabled: false,
    });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.enabled).toBe(false);
    expect(row?.runId).toBeUndefined();
    expect(row?.nextAt).toBeUndefined();
    // The row survives the pause: the cron is still the workflow's configuration.
    expect(row?.cron).toBe(HOURLY);

    const status = await orgA.query(api.schedules.getForWorkflow, { workflowId });
    expect(status.schedule?.enabled).toBe(false);
  });

  test("every write re-checks the org it was handed against the row", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);
    const notFound = { code: "not_found" };

    expect(
      await convexErrorData(
        t.mutation(api.engine.setScheduleEnabled, {
          secret: SECRET,
          scheduleId,
          orgId: OTHER_ORG,
          enabled: false,
        }),
      ),
    ).toEqual(notFound);
    expect(
      await convexErrorData(
        t.mutation(api.engine.setScheduleRunId, {
          secret: SECRET,
          scheduleId,
          orgId: OTHER_ORG,
          runId: "wrun_theirs",
        }),
      ),
    ).toEqual(notFound);
    expect(
      await convexErrorData(
        t.mutation(api.engine.markScheduleFired, {
          secret: SECRET,
          scheduleId,
          orgId: OTHER_ORG,
          firedAt: 1,
        }),
      ),
    ).toEqual(notFound);

    // …and none of them landed.
    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row).toMatchObject({ enabled: true, runId: "wrun_first" });
    expect(row?.lastFiredAt).toBeUndefined();
  });

  test("a schedule for a deleted workflow reads as gone, which is how its run ends itself", async () => {
    const { t, orgA, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);

    await orgA.mutation(api.workflows.remove, { id: workflowId });

    expect(await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId })).toBeNull();
  });
});

describe("api.workflows.list", () => {
  test("reports an enabled schedule so the list can badge it, and forgets a paused one", async () => {
    const { t, orgA, workflowId } = await setup();

    expect((await orgA.query(api.workflows.list, {}))[0].schedule).toBeNull();

    const scheduleId = await enable(t, workflowId, { cron: EVERY_TWO_MINUTES, nextAt: 120_000 });
    expect((await orgA.query(api.workflows.list, {}))[0].schedule).toEqual({
      cron: EVERY_TWO_MINUTES,
      nextAt: 120_000,
    });

    await t.mutation(api.engine.setScheduleEnabled, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      enabled: false,
    });
    expect((await orgA.query(api.workflows.list, {}))[0].schedule).toBeNull();
  });

  test("never shows one org's schedule on another org's list", async () => {
    const { t, orgB, workflowId, otherWorkflowId } = await setup();
    await enable(t, workflowId);

    const theirs = await orgB.query(api.workflows.list, {});
    expect(theirs.map((workflow) => workflow._id)).toEqual([otherWorkflowId]);
    expect(theirs[0].schedule).toBeNull();
  });
});
