import { describe, expect, it } from "vitest";

import {
  ANY,
  filterRuns,
  isFiltered,
  NO_FILTERS,
  statusCounts,
  triggerOptions,
  type FilterableRun,
} from "@/components/runs/run-filters";

const RUNS: FilterableRun[] = [
  { status: "completed", trigger: { type: "manual" }, workflowId: "w1" },
  { status: "failed", trigger: { type: "webhook" }, workflowId: "w1", error: "Slack said 429" },
  { status: "running", trigger: { type: "schedule" }, workflowId: "w2" },
  { status: "completed", trigger: { type: "manual" }, workflowId: "w2" },
  { status: "failed", trigger: { type: "manual" }, workflowId: "w3", error: "Timed out" },
];

const NAMES = { w1: "Invoice chaser", w2: "Daily digest" };

/** `NO_FILTERS` with one field narrowed. */
function only(patch: Partial<typeof NO_FILTERS>) {
  return { ...NO_FILTERS, ...patch };
}

describe("filterRuns", () => {
  it("returns everything when nothing is filtered", () => {
    expect(filterRuns(RUNS, NO_FILTERS, NAMES)).toHaveLength(5);
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });

  it("narrows by status", () => {
    expect(filterRuns(RUNS, only({ status: "failed" }), NAMES)).toHaveLength(2);
    expect(filterRuns(RUNS, only({ status: "running" }), NAMES)).toHaveLength(1);
    expect(filterRuns(RUNS, only({ status: "cancelled" }), NAMES)).toHaveLength(0);
  });

  it("narrows by trigger type", () => {
    expect(filterRuns(RUNS, only({ trigger: "manual" }), NAMES)).toHaveLength(3);
    expect(filterRuns(RUNS, only({ trigger: "schedule" }), NAMES)).toHaveLength(1);
  });

  it("narrows by workflow", () => {
    expect(filterRuns(RUNS, only({ workflow: "w1" }), NAMES)).toHaveLength(2);
  });

  it("matches the workflow's name and the error text, case-insensitively", () => {
    expect(filterRuns(RUNS, only({ text: "invoice" }), NAMES)).toHaveLength(2);
    expect(filterRuns(RUNS, only({ text: "429" }), NAMES)).toHaveLength(1);
    expect(filterRuns(RUNS, only({ text: "TIMED OUT" }), NAMES)).toHaveLength(1);
    expect(filterRuns(RUNS, only({ text: "  digest  " }), NAMES)).toHaveLength(2);
  });

  it("matches nothing but the error when the workflow has no name left", () => {
    // `w3` was deleted, so only its run's error is searchable.
    expect(filterRuns(RUNS, only({ text: "timed" }), NAMES)).toHaveLength(1);
    expect(filterRuns(RUNS, only({ text: "w3" }), NAMES)).toHaveLength(0);
  });

  it("still searches errors with no names map at all", () => {
    expect(filterRuns(RUNS, only({ text: "slack" }))).toHaveLength(1);
  });

  it("combines every filter", () => {
    const both = filterRuns(RUNS, { status: "failed", trigger: "manual", workflow: "w3", text: "timed" }, NAMES);
    expect(both).toHaveLength(1);
    expect(both[0].error).toBe("Timed out");

    // One contradiction is enough to empty the list.
    expect(
      filterRuns(RUNS, { status: "failed", trigger: "manual", workflow: "w1", text: "" }, NAMES),
    ).toHaveLength(0);
  });

  it("knows when a Clear button is worth showing", () => {
    expect(isFiltered(only({ status: "failed" }))).toBe(true);
    expect(isFiltered(only({ trigger: "manual" }))).toBe(true);
    expect(isFiltered(only({ workflow: "w1" }))).toBe(true);
    expect(isFiltered(only({ text: "  " }))).toBe(false);
    expect(isFiltered(only({ text: "x" }))).toBe(true);
  });
});

describe("statusCounts", () => {
  it("counts every status on the page, and the page itself", () => {
    const counts = statusCounts(RUNS);

    expect(counts[ANY]).toBe(5);
    expect(counts.completed).toBe(2);
    expect(counts.failed).toBe(2);
    expect(counts.running).toBe(1);
    // A chip with no runs is not drawn, so an absent key is the answer, not zero.
    expect(counts.cancelled).toBeUndefined();
  });
});

describe("triggerOptions", () => {
  it("lists each trigger present once, alphabetically", () => {
    expect(triggerOptions(RUNS)).toEqual(["manual", "schedule", "webhook"]);
    expect(triggerOptions([])).toEqual([]);
  });
});
