import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  formatOffset,
  formatSpan,
  formatTick,
  graphNodeNames,
  orderSteps,
  passCounts,
  rowLabel,
  tickStepMs,
  ticksFor,
  type TimelineStep,
} from "@/components/canvas/run-timeline";

/** t=0 for every fixture, so an offset in an expectation is the number you can read off the run. */
const T0 = 1_700_000_000_000;

function step(over: Partial<TimelineStep> & { _id: string; nodeId: string }): TimelineStep {
  return {
    nodeType: "http.request",
    status: "success",
    attempt: 1,
    startedAt: T0,
    finishedAt: T0 + 100,
    ...over,
  };
}

describe("orderSteps", () => {
  it("keeps top-level rows in creation order and hangs children off their parent", () => {
    const rows = orderSteps([
      step({ _id: "a", nodeId: "n1" }),
      step({ _id: "b", nodeId: "n2" }),
      // Written after both parents, but it belongs under the first one.
      step({ _id: "a1", nodeId: "n1#0", parentStepId: "a" }),
    ]);

    expect(rows.map((row) => row._id)).toEqual(["a", "a1", "b"]);
  });

  it("promotes a child whose parent is not in the run rather than dropping it", () => {
    const rows = orderSteps([step({ _id: "orphan", nodeId: "n9", parentStepId: "gone" })]);
    expect(rows.map((row) => row._id)).toEqual(["orphan"]);
  });
});

describe("passCounts", () => {
  it("counts only the rows a loop body produced", () => {
    const counts = passCounts([
      step({ _id: "a", nodeId: "set", iteration: 0 }),
      step({ _id: "b", nodeId: "set", iteration: 1 }),
      step({ _id: "c", nodeId: "http" }),
    ]);

    expect(counts).toEqual({ set: 2 });
  });
});

describe("rowLabel", () => {
  it("prefers the canvas label, then the registry name, then the type", () => {
    const row = step({ _id: "a", nodeId: "n1" });
    expect(rowLabel(row, { label: "Fetch order", key: "http_request_1" })).toBe("Fetch order");
    expect(rowLabel(row)).toBe("HTTP Request");
    expect(rowLabel(step({ _id: "a", nodeId: "n1", nodeType: "not.installed" }))).toBe(
      "not.installed",
    );
  });

  it("names a tool call by the tool, not by a node that does not exist", () => {
    const tool = step({ _id: "a1", nodeId: "n1#0", nodeType: "agent.tool:slack_post" });
    expect(rowLabel(tool)).toBe("slack_post");
  });
});

describe("tickStepMs", () => {
  it("picks a rung a person would read off a clock", () => {
    // 900ms across ~5 ticks wants 180ms; 250 is the first rung that is not finer than that.
    expect(tickStepMs(900)).toBe(250);
    expect(tickStepMs(5_000)).toBe(1_000);
    expect(tickStepMs(45_000)).toBe(10_000);
    expect(tickStepMs(10 * 60_000)).toBe(120_000);
  });

  it("never returns zero for a run with no measurable span", () => {
    expect(tickStepMs(0)).toBeGreaterThan(0);
  });

  it("keeps the axis inside `target` labels", () => {
    for (const span of [37, 900, 5_000, 61_000, 3_600_000]) {
      expect(ticksFor(span).length).toBeLessThanOrEqual(6);
    }
  });
});

describe("formatting", () => {
  it("uses the unit the step chose, so one ruler never mixes them", () => {
    expect(formatTick(0, 250)).toBe("0");
    expect(formatTick(500, 250)).toBe("500ms");
    expect(formatTick(1_500, 1_000)).toBe("1.5s");
    expect(formatTick(2_000, 1_000)).toBe("2s");
    expect(formatTick(120_000, 60_000)).toBe("2m");
    expect(formatTick(150_000, 60_000)).toBe("2m 30s");
  });

  it("says durations and offsets the way a person would", () => {
    expect(formatSpan(240)).toBe("240ms");
    expect(formatSpan(1_240)).toBe("1.2s");
    expect(formatSpan(125_000)).toBe("2m 5s");
    expect(formatOffset(0)).toBe("start");
    expect(formatOffset(1_200)).toBe("+1.2s");
  });
});

describe("graphNodeNames", () => {
  it("indexes a stored graph and shrugs off anything malformed", () => {
    const names = graphNodeNames({
      nodes: [
        { id: "n1", data: { label: "Fetch order", key: "http_request_1" } },
        { id: "n2" },
        "nonsense",
        null,
      ],
    });

    expect(names.n1).toEqual({ label: "Fetch order", key: "http_request_1" });
    expect(names.n2).toBeUndefined();
    expect(graphNodeNames(undefined)).toEqual({});
  });
});

describe("buildTimeline", () => {
  it("lays three steps out in execution order on one axis, with the trigger at zero", () => {
    const timeline = buildTimeline({
      startedAt: T0,
      finishedAt: T0 + 1_000,
      now: T0 + 5_000,
      names: { t: { label: "When I click Run", key: "manual_trigger_1" } },
      steps: [
        step({ _id: "s1", nodeId: "t", nodeType: "manual.trigger", finishedAt: T0 + 100 }),
        step({ _id: "s2", nodeId: "h", startedAt: T0 + 200, finishedAt: T0 + 700 }),
        step({ _id: "s3", nodeId: "e", nodeType: "email.send", startedAt: T0 + 700, finishedAt: T0 + 1_000 }),
      ],
    });

    expect(timeline.spanMs).toBe(1_000);
    expect(timeline.rows.map((row) => row.id)).toEqual(["s1", "s2", "s3"]);

    const [trigger, http, email] = timeline.rows;
    expect(trigger.label).toBe("When I click Run");
    expect(trigger.startMs).toBe(0);
    expect(trigger.leftPct).toBe(0);
    expect(trigger.widthPct).toBeCloseTo(10);

    expect(http.startMs).toBe(200);
    expect(http.durationMs).toBe(500);
    expect(http.leftPct).toBeCloseTo(20);
    expect(http.widthPct).toBeCloseTo(50);

    // The whole point of a stepped chart: the 100ms hole between the trigger ending and the HTTP
    // request starting is a mark of its own, and the step that follows immediately has none.
    expect(http.gapMs).toBe(100);
    expect(http.gapLeftPct).toBeCloseTo(10);
    expect(http.gapWidthPct).toBeCloseTo(10);
    expect(trigger.gapMs).toBeNull();
    expect(email.gapMs).toBeNull();
  });

  it("runs an unfinished step to the end of the axis and reports no duration", () => {
    const timeline = buildTimeline({
      startedAt: T0,
      now: T0 + 4_000,
      steps: [
        step({ _id: "s1", nodeId: "t", nodeType: "manual.trigger", finishedAt: T0 + 500 }),
        step({ _id: "s2", nodeId: "h", startedAt: T0 + 500, finishedAt: undefined, status: "running" }),
      ],
    });

    const running = timeline.rows[1];
    expect(timeline.spanMs).toBe(4_000);
    expect(running.open).toBe(true);
    expect(running.durationMs).toBeNull();
    expect(running.endMs).toBe(timeline.spanMs);
    expect(running.leftPct + running.widthPct).toBeCloseTo(100);
  });

  it("numbers a loop body's passes against the passes this run has so far", () => {
    const timeline = buildTimeline({
      startedAt: T0,
      now: T0 + 300,
      names: { set: { label: "Set", key: "set_1" } },
      steps: [
        step({ _id: "p1", nodeId: "set", nodeType: "logic.set", iteration: 0, startedAt: T0, finishedAt: T0 + 100 }),
        step({ _id: "p2", nodeId: "set", nodeType: "logic.set", iteration: 1, startedAt: T0 + 100, finishedAt: T0 + 200 }),
        step({ _id: "p3", nodeId: "set", nodeType: "logic.set", iteration: 2, startedAt: T0 + 200, finishedAt: T0 + 300 }),
      ],
    });

    expect(timeline.rows.map((row) => row.pass)).toEqual(["1/3", "2/3", "3/3"]);
    // Every pass is a row of its own, all under the same name.
    expect(new Set(timeline.rows.map((row) => row.label))).toEqual(new Set(["Set"]));
  });

  it("nests a tool call under the node that made it and leaves it keyless", () => {
    const timeline = buildTimeline({
      startedAt: T0,
      now: T0 + 900,
      names: { a: { label: "Assistant", key: "agent_1" } },
      steps: [
        step({ _id: "s1", nodeId: "a", nodeType: "ai.agent", finishedAt: T0 + 900 }),
        step({
          _id: "s1a",
          nodeId: "a#0",
          nodeType: "agent.tool:slack_post",
          parentStepId: "s1",
          startedAt: T0 + 300,
          finishedAt: T0 + 400,
        }),
      ],
    });

    const [parent, child] = timeline.rows;
    expect(parent.child).toBe(false);
    expect(parent.nodeKey).toBe("agent_1");
    expect(child.child).toBe(true);
    expect(child.label).toBe("slack_post");
    expect(child.nodeKey).toBe("");
    // The child sits inside its parent's bar, so it cannot be reported as dead time.
    expect(child.gapMs).toBeNull();
  });

  it("gives a run with no steps an axis rather than dividing by zero", () => {
    const timeline = buildTimeline({ startedAt: T0, now: T0, steps: [] });
    expect(timeline.rows).toEqual([]);
    expect(timeline.spanMs).toBe(1);
    expect(timeline.ticks.length).toBeGreaterThan(0);
  });

  it("keeps a step too short to see clickable", () => {
    const timeline = buildTimeline({
      startedAt: T0,
      now: T0 + 60_000,
      steps: [
        step({ _id: "s1", nodeId: "t", nodeType: "manual.trigger", finishedAt: T0 + 1 }),
        step({ _id: "s2", nodeId: "h", startedAt: T0 + 1, finishedAt: T0 + 60_000 }),
      ],
    });

    expect(timeline.rows[0].durationMs).toBe(1);
    expect(timeline.rows[0].widthPct).toBeGreaterThan(0.5);
  });
});
