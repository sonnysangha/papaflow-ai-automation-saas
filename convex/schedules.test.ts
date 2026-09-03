import { convexTest } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PLAN_LIMITS } from "../lib/plans";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

/**
 * The `schedules` table and the alarm clock that rings it, from both sides: the one query a
 * browser may call (`getForWorkflow`, behind a Clerk session) and the secret-checked engine surface
 * `lib/engine-client.ts` and `convex/schedules.ts#fire` use.
 *
 * `guard()` reads `process.env` at call time, so this only has to be set before the first call — but
 * it is set here, before any `convexTest` instance exists, so nothing can race it. `fire` reads the
 * *same* variable as the outbound bearer token, which is what makes `SECRET` do double duty below:
 * it is both the argument every `api.engine.*` call carries and the token `fire`'s own `fetch` call
 * sends to `/api/engine/schedule-tick`.
 *
 * Convex scheduler APIs used here are verified against `node_modules/convex@1.45.0`:
 * `ctx.scheduler.runAt`/`runAfter` return `Id<"_scheduled_functions">`, `ctx.db.system.get` reads a
 * job's `{ state: { kind: "pending" | "inProgress" | "success" | "failed" | "canceled" }, … }` (all
 * confirmed in `server/scheduler.d.ts` and `server/schema.d.ts`). `convex-test@0.0.56`'s mocked
 * `cancel_job` unconditionally sets `state.kind` to `"canceled"` regardless of the job's prior state
 * (`node_modules/convex-test/dist/index.js`), which is what makes "re-arming cancels the old job"
 * observable below even though a *pending* job is the only kind `convex/schedules.ts` ever cancels.
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

/** Writes the row and arms it for `nextAt` — the two calls `enableSchedule` makes in sequence. */
async function enable(
  t: Awaited<ReturnType<typeof setup>>["t"],
  workflowId: Id<"workflows">,
  overrides: { cron?: string; timezone?: string; nextAt?: number } = {},
): Promise<Id<"schedules">> {
  const nextAt = overrides.nextAt ?? 1_800_000;
  const scheduleId = await t.mutation(api.engine.upsertSchedule, {
    secret: SECRET,
    orgId: ORG,
    workflowId,
    cron: overrides.cron ?? HOURLY,
    timezone: overrides.timezone ?? "UTC",
    enabled: true,
    nextAt,
  });

  await t.mutation(api.engine.armSchedule, { secret: SECRET, scheduleId, orgId: ORG, nextAt });

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

  test("shows the live row once it has been armed", async () => {
    const { t, orgA, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: 1_800_000 });

    const status = await orgA.query(api.schedules.getForWorkflow, { workflowId });
    expect(status.schedule).toMatchObject({
      _id: scheduleId,
      cron: HOURLY,
      timezone: "UTC",
      enabled: true,
      nextAt: 1_800_000,
    });
    // The projection is explicit: the row's org, and the Convex job it is sleeping on, never cross
    // to the client.
    expect(status.schedule).not.toHaveProperty("orgId");
    expect(status.schedule).not.toHaveProperty("jobId");
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
        t.mutation(api.engine.armSchedule, {
          secret: "nope",
          scheduleId,
          orgId: ORG,
          nextAt: 1_800_000,
        }),
      ),
    ).toEqual(unauthorized);
    expect(
      await convexErrorData(
        t.mutation(api.engine.disarmSchedule, { secret: "nope", scheduleId, orgId: ORG }),
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
    // A rewrite carries the job through rather than clearing it: `enableSchedule` upserts first and
    // arms second, so the row between those two calls still names the job from the previous cron —
    // `arm` is what actually cancels it.
    expect(row?.jobId).toBeDefined();
    // …but forgets a stale error and retry count, which belonged to the schedule just replaced.
    expect(row?.lastError).toBeUndefined();
    expect(row?.attempts).toBeUndefined();

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

  test("getSchedule hands the app the org and workflow it needs to start the run", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);

    expect(await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId })).toMatchObject({
      _id: scheduleId,
      orgId: ORG,
      workflowId,
      cron: HOURLY,
      enabled: true,
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

  test("armSchedule stores a job id and the instant it is armed for", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await t.mutation(api.engine.upsertSchedule, {
      secret: SECRET,
      orgId: ORG,
      workflowId,
      cron: HOURLY,
      timezone: "UTC",
      enabled: true,
    });
    const nextAt = Date.now() + 3_600_000;

    const jobId = await t.mutation(api.engine.armSchedule, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      nextAt,
    });
    expect(jobId).not.toBeNull();

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.jobId).toBe(jobId);
    expect(row?.nextAt).toBe(nextAt);
    expect(row?.plannedAt).toBe(nextAt);

    const job = await t.run(
      async (ctx) => await ctx.db.system.get(jobId as Id<"_scheduled_functions">),
    );
    expect(job?.state.kind).toBe("pending");
    expect(job?.scheduledTime).toBe(nextAt);
  });

  test("re-arming cancels whatever job was pending before scheduling the replacement", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await t.mutation(api.engine.upsertSchedule, {
      secret: SECRET,
      orgId: ORG,
      workflowId,
      cron: HOURLY,
      timezone: "UTC",
      enabled: true,
    });

    const firstJobId = await t.mutation(api.engine.armSchedule, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      nextAt: Date.now() + 3_600_000,
    });
    const secondJobId = await t.mutation(api.engine.armSchedule, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      nextAt: Date.now() + 7_200_000,
    });

    expect(secondJobId).not.toBe(firstJobId);

    const firstJob = await t.run(
      async (ctx) => await ctx.db.system.get(firstJobId as Id<"_scheduled_functions">),
    );
    expect(firstJob?.state.kind).toBe("canceled");

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.jobId).toBe(secondJobId);
  });

  test("armSchedule leaves a disabled row alone rather than arming it", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await t.mutation(api.engine.upsertSchedule, {
      secret: SECRET,
      orgId: ORG,
      workflowId,
      cron: HOURLY,
      timezone: "UTC",
      enabled: false,
    });

    const jobId = await t.mutation(api.engine.armSchedule, {
      secret: SECRET,
      scheduleId,
      orgId: ORG,
      nextAt: Date.now() + 3_600_000,
    });
    expect(jobId).toBeNull();

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.jobId).toBeUndefined();
  });

  test("disarmSchedule cancels the pending job and disables the row", async () => {
    const { t, orgA, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: 1_800_000 });
    const armed = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    const jobId = armed?.jobId as Id<"_scheduled_functions">;

    await t.mutation(api.engine.disarmSchedule, { secret: SECRET, scheduleId, orgId: ORG });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.enabled).toBe(false);
    expect(row?.jobId).toBeUndefined();
    expect(row?.nextAt).toBeUndefined();
    expect(row?.plannedAt).toBeUndefined();
    // The row survives disarming: the cron is still the workflow's configuration.
    expect(row?.cron).toBe(HOURLY);

    const job = await t.run(async (ctx) => await ctx.db.system.get(jobId));
    expect(job?.state.kind).toBe("canceled");

    const status = await orgA.query(api.schedules.getForWorkflow, { workflowId });
    expect(status.schedule?.enabled).toBe(false);
  });

  test("disarmSchedule is idempotent — pressing Unpublish twice is not an error", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);

    await t.mutation(api.engine.disarmSchedule, { secret: SECRET, scheduleId, orgId: ORG });
    await t.mutation(api.engine.disarmSchedule, { secret: SECRET, scheduleId, orgId: ORG });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.enabled).toBe(false);
  });

  test("every write re-checks the org it was handed against the row", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);
    const notFound = { code: "not_found" };

    expect(
      await convexErrorData(
        t.mutation(api.engine.armSchedule, {
          secret: SECRET,
          scheduleId,
          orgId: OTHER_ORG,
          nextAt: Date.now() + 60_000,
        }),
      ),
    ).toEqual(notFound);
    expect(
      await convexErrorData(
        t.mutation(api.engine.disarmSchedule, { secret: SECRET, scheduleId, orgId: OTHER_ORG }),
      ),
    ).toEqual(notFound);

    // …and neither landed.
    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.enabled).toBe(true);
    expect(row?.jobId).toBeDefined();
  });

  test("a schedule for a deleted workflow reads as gone, and its job is cancelled with it", async () => {
    const { t, orgA, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId);
    const armed = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    const jobId = armed?.jobId as Id<"_scheduled_functions">;

    await orgA.mutation(api.workflows.remove, { id: workflowId });

    expect(await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId })).toBeNull();

    const job = await t.run(async (ctx) => await ctx.db.system.get(jobId));
    expect(job?.state.kind).toBe("canceled");
  });
});

/**
 * `internal.schedules.fire` — the alarm going off.
 *
 * Called directly (`t.action(internal.schedules.fire, …)`) for every scenario except the last: a
 * scheduled action's real handler runs in-process under convex-test, exactly like any other
 * function, so this needs no more than mocking `global.fetch` — the same idiom already used
 * elsewhere in this repo for an action under test (`tests/http-request-auth.test.ts`). Driving `fire`
 * directly rather than through Convex's own timer is what makes the retry-then-fallback and
 * duplicate-delivery cases deterministic: each simulated delivery is one direct call with the
 * `attempt` a real retry would have carried.
 *
 * The last test below is the exception, and the one worth the most: it proves the *wiring* — that
 * `arm`'s `runAt(nextAt, internal.schedules.fire, …)` really does reach this handler when Convex's
 * own scheduler runs it, using `vi.useFakeTimers()` with `t.finishAllScheduledFunctions(vi.runAllTimers)`
 * exactly as `node_modules/convex-test/dist/index.d.ts` documents.
 */
describe("internal.schedules.fire", () => {
  const TICK_URL = "https://app.test/api/engine/schedule-tick";

  function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  beforeEach(() => {
    process.env.APP_ORIGIN = "https://app.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.APP_ORIGIN;
  });

  test("posts the bearer and body, then records the tick and arms nextAt", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ started: true, executionId: "exec_1", nextAt: 5_400_000 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const plannedAt = 1_800_000;
    await t.action(internal.schedules.fire, { scheduleId, plannedAt, attempt: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TICK_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toEqual({ scheduleId, workflowId, orgId: ORG, plannedAt });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.lastFiredAt).toBe(plannedAt);
    expect(row?.lastError).toBeUndefined();
    expect(row?.attempts).toBe(0);
    expect(row?.nextAt).toBe(5_400_000);
    // Recorded and re-armed for the next occurrence, in the same transaction.
    expect(row?.plannedAt).toBe(5_400_000);
    expect(row?.jobId).toBeDefined();
  });

  test("a run_limit refusal is still a tick that worked", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ started: false, reason: "run_limit", nextAt: 5_400_000 }, 200)),
    );

    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 1_800_000, attempt: 0 });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.lastError).toBeUndefined();
    expect(row?.nextAt).toBe(5_400_000);
  });

  test("no future occurrence leaves the schedule enabled with nothing armed", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ started: true }, 200)));

    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 1_800_000, attempt: 0 });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.enabled).toBe(true);
    expect(row?.jobId).toBeUndefined();
    expect(row?.nextAt).toBeUndefined();
  });

  test("a 4xx disarms the schedule and records why", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "not_published", error: "not running" }, 409)),
    );

    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 1_800_000, attempt: 0 });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.enabled).toBe(false);
    expect(row?.jobId).toBeUndefined();
    expect(row?.lastError).toMatch(/refused/);
  });

  test("a 5xx retries the same tick, then falls back once attempts run out", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("Service Unavailable", 503));
    vi.stubGlobal("fetch", fetchMock);

    const plannedAt = 1_800_000;

    // Attempt 0 claims the tick, fails, and arms a retry.
    await t.action(internal.schedules.fire, { scheduleId, plannedAt, attempt: 0 });
    let row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.attempts).toBe(1);
    expect(row?.lastFiredAt).toBe(plannedAt);
    expect(row?.jobId).toBeDefined();
    expect(row?.enabled).toBe(true);

    // Attempts 1 and 2 do not re-claim — they are deliveries of the tick attempt 0 already claimed.
    await t.action(internal.schedules.fire, { scheduleId, plannedAt, attempt: 1 });
    await t.action(internal.schedules.fire, { scheduleId, plannedAt, attempt: 2 });
    row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.attempts).toBe(3);

    // Attempt 3 is the last one `MAX_ATTEMPTS` allows: give up and fall back ~15 minutes out.
    const before = Date.now();
    await t.action(internal.schedules.fire, { scheduleId, plannedAt, attempt: 3 });
    row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.attempts).toBe(4);
    expect(row?.enabled).toBe(true);
    expect(row?.lastError).toMatch(/15 minutes/);
    expect(row?.nextAt).toBeGreaterThanOrEqual(before + 15 * 60_000 - 1_000);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("an unreachable app backs off the same way as a 5xx", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 1_800_000, attempt: 0 });

    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatch(/did not respond/);
    expect(row?.enabled).toBe(true);
  });

  test("the claim guard blocks a duplicate delivery of the same tick", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ started: true, nextAt: Date.now() + 3_600_000 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const plannedAt = 1_800_000;
    await t.action(internal.schedules.fire, { scheduleId, plannedAt, attempt: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second, duplicate delivery of the exact same tick — `claimTick` sees `lastFiredAt` already
    // covers `plannedAt` and refuses before the app is ever asked again.
    await t.action(internal.schedules.fire, { scheduleId, plannedAt, attempt: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a later tick still fires after an earlier one was claimed", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ started: true, nextAt: Date.now() + 3_600_000 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 1_800_000, attempt: 0 });
    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 5_400_000, attempt: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.lastFiredAt).toBe(5_400_000);
  });

  test("a disabled schedule fires nothing", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });
    await t.mutation(api.engine.disarmSchedule, { secret: SECRET, scheduleId, orgId: ORG });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 1_800_000, attempt: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("missing APP_ORIGIN or ENGINE_SECRET falls back without ever calling fetch", async () => {
    const { t, workflowId } = await setup();
    const scheduleId = await enable(t, workflowId, { nextAt: Date.now() + 60_000 });
    delete process.env.APP_ORIGIN;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.schedules.fire, { scheduleId, plannedAt: 1_800_000, attempt: 0 });

    expect(fetchMock).not.toHaveBeenCalled();
    const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
    expect(row?.lastError).toMatch(/APP_ORIGIN/);
    expect(row?.enabled).toBe(true);
    expect(row?.nextAt).toBeGreaterThan(Date.now());
  });

  test("an armed schedule actually fires through Convex's own scheduler", async () => {
    vi.useFakeTimers();
    try {
      const { t, workflowId } = await setup();
      const scheduleId = await t.mutation(api.engine.upsertSchedule, {
        secret: SECRET,
        orgId: ORG,
        workflowId,
        cron: HOURLY,
        timezone: "UTC",
        enabled: true,
      });

      // No `nextAt` in the response, deliberately: this test's only job is to prove the *wiring* —
      // that `ctx.scheduler.runAt(nextAt, internal.schedules.fire, …)` really does reach this
      // handler when Convex's own scheduler runs it. Re-arming is already proven directly, by
      // "posts the bearer and body…" above.
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ started: true, executionId: "exec_1" }, 200));
      vi.stubGlobal("fetch", fetchMock);

      const soon = Date.now() + 1_000;
      await t.mutation(api.engine.armSchedule, { secret: SECRET, scheduleId, orgId: ORG, nextAt: soon });

      // A *bounded* advance rather than `vi.runAllTimers()`, deliberately: every schedule armed by
      // an earlier test in this file (many seconds or hours out — `Date.now() + 60_000` and similar)
      // is still a pending job when this test starts, since none of those tests ever let its real
      // timer fire. `runAllTimers()` drains a fake clock all the way to empty regardless of how far
      // out a job is armed for, which sweeps every one of them up too — this only needs to cross the
      // ~1 second until *this* schedule's own job, so nothing else armed anywhere near as far out is
      // ever reached. `node_modules/convex-test/dist/index.d.ts`'s own guidance is "use
      // vi.runAllTimers() or similar to advance time such that a function is scheduled" — this is
      // the "or similar".
      vi.advanceTimersByTime(1_500);
      await t.finishInProgressScheduledFunctions();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(TICK_URL);
      expect(JSON.parse(init.body as string)).toMatchObject({ scheduleId, workflowId });

      const row = await t.query(api.engine.getSchedule, { secret: SECRET, scheduleId });
      expect(row?.lastFiredAt).toBe(soon);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("api.workflows.list", () => {
  test("reports an enabled schedule so the list can badge it, and forgets a disarmed one", async () => {
    const { t, orgA, workflowId } = await setup();

    expect((await orgA.query(api.workflows.list, {}))[0].schedule).toBeNull();

    const scheduleId = await enable(t, workflowId, { cron: EVERY_TWO_MINUTES, nextAt: 120_000 });
    expect((await orgA.query(api.workflows.list, {}))[0].schedule).toEqual({
      cron: EVERY_TWO_MINUTES,
      nextAt: 120_000,
    });

    await t.mutation(api.engine.disarmSchedule, { secret: SECRET, scheduleId, orgId: ORG });
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
