import { z } from "zod";

import { defineNode } from "../define";

/**
 * The Schedule trigger: this workflow runs itself, on a repeat.
 *
 * There is no cron infrastructure behind it. Enabling the schedule starts one durable run of
 * `workflows/scheduler.ts`, which computes the next fire time in a step, `sleep()`s until it, starts
 * the graph, and goes back to sleep — so a paused schedule is a cancelled run and there is nothing
 * to poll. `app/api/schedules/route.ts` owns that transition; this node only describes what the
 * user asked for.
 *
 * `mode` decides which of the next two fields matters: `every` generates the cron
 * (`lib/schedule.ts#toCron`), `cron` is the expression itself. Both end up as cron on the
 * `schedules` row, because that is the only language the scheduler speaks.
 *
 * As with every other trigger, nothing calls `run` during a real run: the scheduler hands its
 * payload to `startRun`, which writes the trigger's step row from it. It stays here so the node is
 * complete on its own, and answers with exactly the shape the scheduler produces.
 */
export const scheduleTriggerNode = defineNode({
  type: "schedule.trigger",
  name: "Schedule",
  description: "Starts the workflow on a repeat — every few minutes, or on a cron expression.",
  category: "trigger",
  icon: "CalendarClock",
  credential: null,
  // Deliberately null: the free plan may run an hourly schedule, and only a *frequent* one needs
  // the `schedules` feature. That is an interval question, not a node question, so the route
  // decides it (`lib/schedule.ts#validateSchedule` against `PLAN_LIMITS.minScheduleMinutes`) and
  // `runNode` is left to gate the nodes downstream of this one.
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    mode: z
      .enum(["every", "cron"])
      .default("every")
      .describe("every: a fixed interval. cron: a five-field expression you write yourself."),
    everyMinutes: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(60)
      .describe("Minutes between runs, when mode is every. Your plan sets the smallest allowed."),
    cron: z
      .string()
      .optional()
      .describe("Five fields — minute hour day month weekday — when mode is cron. e.g. 0 9 * * 1-5"),
    timezone: z
      .string()
      .optional()
      .describe("IANA name the expression is read in, e.g. Europe/London. Defaults to UTC."),
  }),
  outputs: z.object({
    /** ISO 8601, the tick this run was scheduled for — not the moment the step happened to wake. */
    firedAt: z.string(),
    /** The `schedules` row that started it, so a run can be traced back to its schedule. */
    scheduleId: z.string(),
  }),
  async run() {
    return { firedAt: new Date().toISOString(), scheduleId: "" };
  },
});

/** The Schedule trigger's configuration once parsed. */
export type ScheduleInputs = z.infer<typeof scheduleTriggerNode.inputs>;

/**
 * The stored graph is `v.any()` on the Convex side, so the route runs whatever the canvas saved
 * through the node's own schema before trusting it — defaults filled in, junk refused. `null` means
 * "there is no usable schedule trigger here", which the route answers with a 400.
 */
export function parseScheduleInputs(inputs: unknown): ScheduleInputs | null {
  const parsed = scheduleTriggerNode.inputs.safeParse(inputs ?? {});
  return parsed.success ? parsed.data : null;
}
