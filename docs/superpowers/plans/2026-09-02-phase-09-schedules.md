# Phase 9 — Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one Opus subagent per task. Tests first for the cron math.

**Goal:** A Schedule trigger backed by a sleeping scheduler workflow (no cron infrastructure): compute the next fire time in a step, `sleep(untilDate)`, start the graph run from a step, repeat; continue-as-new every 200 iterations; pausing cancels the scheduler run; plan-gated minimum interval.

**Verified facts:** `sleep(new Date(iso))` has no maximum and costs nothing while sleeping; `start(scheduler, [args], { deploymentId: "latest" })` may be called directly in a workflow body (v5, step-backed) and picks up new code; `getRun(runId).cancel({ cancelReason })` only in steps/routes; 8 events per iteration against the 25,000-event cap → ~200 iterations per run; `croner 10.0.1` computes next occurrences (`new Cron(expr, { timezone }).nextRun(from)`).

## File structure

```
workflows/scheduler.ts                 "use workflow" scheduler({ scheduleId, cron, timezone })
workflows/steps/schedule-steps.ts      computeNext, fireSchedule (checks enabled, startRun with trigger { type: "schedule", payload: { firedAt } }), stillEnabled
nodes/triggers/schedule.ts             schedule.trigger: { mode: "every"|"cron", everyMinutes?, cron?, timezone? } outputs { firedAt }
convex/schedules.ts                    api: upsertForWorkflow, pause, resume, get; internal + engine: get, setRunId, markFired
convex/engine.ts (mod)                 getSchedule, markScheduleFired (secret-checked)
app/api/schedules/route.ts             POST start/pause (auth + has("org:schedules") + PLAN_LIMITS.minScheduleMinutes) → start(scheduler) / getRun(runId).cancel()
components/canvas/ScheduleConfig.tsx   next run preview, Enable/Pause switch
tests/schedule.test.ts
```

## Tasks
- [ ] Task 1: cron helpers + tests (`lib/schedule.ts#nextFireTime(spec, from)`, `toCron({ mode, everyMinutes, cron })`, validation with croner; minimum interval check against `limitsForPlan(plan).minScheduleMinutes`).
- [ ] Task 2: Convex `schedules` functions + engine-secret helpers; `scheduler.ts` loop of 200 iterations with `sleep(new Date(nextAt))` → `fireSchedule` step (returns `false` when the schedule is paused/deleted → return) → after the loop `await start(scheduler, [args], { deploymentId: "latest" })`; the scheduler's `runId` is stored on the schedule row on start and on every continue-as-new (`fireSchedule`/`continue` steps write it).
- [ ] Task 3: trigger node + `ScheduleConfig` + `/api/schedules` (Enable → `has({ feature: "org:schedules" })` unless `mode === "every"` with `everyMinutes ≥ 60` on `free_org`; start; Pause → cancel + `enabled: false`; editing the cron cancels and restarts).
- [ ] Phase check: "every 2 minutes" fires twice while watching; pause → no further runs; force continue-as-new in dev with `SCHEDULER_MAX_ITERATIONS=2` and confirm `schedules.runId` changes.
