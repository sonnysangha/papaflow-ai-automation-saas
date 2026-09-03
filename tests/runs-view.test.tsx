import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunRow } from "@/components/runs/RunRow";
import { RunStatsSkeleton, RunStatsStrip } from "@/components/runs/RunStats";
import { runStats } from "@/components/runs/run-stats";

const NOW = 1_700_000_000_000;

/** A row is a `<tr>`, so it needs a table around it to be valid markup. */
function renderRow(node: React.ReactNode) {
  return renderToStaticMarkup(
    <table>
      <tbody>{node}</tbody>
    </table>,
  );
}

describe("RunStatsStrip", () => {
  it("shows every number, the window it covers, and what each one is measured against", () => {
    const stats = runStats(
      [
        { status: "completed", startedAt: NOW - 60_000, finishedAt: NOW - 58_000 },
        { status: "completed", startedAt: NOW - 50_000, finishedAt: NOW - 46_000 },
        { status: "failed", startedAt: NOW - 40_000, finishedAt: NOW - 39_000 },
        { status: "running", startedAt: NOW - 30_000 },
      ],
      NOW,
    );
    const html = renderToStaticMarkup(<RunStatsStrip stats={stats} windowDays={7} />);

    expect(html).toContain("Runs loaded");
    expect(html).toContain(">4<");
    expect(html).toContain("Last 7 days, newest first");
    // 2 of 3 finished runs completed.
    expect(html).toContain("67%");
    expect(html).toContain("2 of 3 finished runs");
    // The average covers the two completed runs (2s and 4s), not the failure or the open run.
    expect(html).toContain("3.0s");
    expect(html).toContain("Across 2 completed runs");
    expect(html).toContain("Oldest going for 30.0s");
  });

  it("says nothing has finished rather than showing a zero rate", () => {
    const html = renderToStaticMarkup(
      <RunStatsStrip stats={runStats([{ status: "running", startedAt: NOW }], NOW)} windowDays={30} />,
    );

    expect(html).toContain("Nothing has finished yet");
    expect(html).toContain("No completed runs yet");
    expect(html).toContain("None in this list");
  });

  it("has a skeleton with the same five cards", () => {
    const html = renderToStaticMarkup(<RunStatsSkeleton />);

    expect(html).toContain("Loading run statistics");
    expect(html.split("animate-pulse").length - 1).toBe(15);
  });
});

describe("RunRow", () => {
  it("shows the run's status, trigger, age, duration and error", () => {
    const html = renderRow(
      <RunRow
        run={{
          _id: "e1",
          workflowId: "w1",
          status: "failed",
          trigger: { type: "webhook" },
          startedAt: NOW - 120_000,
          finishedAt: NOW - 118_800,
          error: "Slack said 429",
        }}
        showWorkflow
        workflowName="Invoice chaser"
        now={NOW}
        onOpen={() => {}}
      />,
    );

    expect(html).toContain("Failed");
    expect(html).toContain("Webhook");
    expect(html).toContain("2 minutes ago");
    expect(html).toContain("1.2s");
    expect(html).toContain("Slack said 429");
    expect(html).toContain("/w/w1");
    expect(html).toContain("Invoice chaser");
    // The row itself is focusable, so Enter and Space can open the drawer.
    expect(html).toContain('tabindex="0"');
  });

  it("counts a still-running run up against the table's clock", () => {
    const html = renderRow(
      <RunRow
        run={{
          _id: "e2",
          workflowId: "w2",
          status: "running",
          trigger: { type: "manual" },
          startedAt: NOW - 4_500,
        }}
        now={NOW}
        onOpen={() => {}}
      />,
    );

    expect(html).toContain("Running");
    expect(html).toContain("4.5s");
    // No workflow column on a single workflow's page.
    expect(html).not.toContain("/w/w2");
  });

  it("names a workflow that has since been deleted instead of linking to it", () => {
    const html = renderRow(
      <RunRow
        run={{
          _id: "e3",
          workflowId: "gone",
          status: "completed",
          trigger: { type: "schedule" },
          startedAt: NOW - 1_000,
          finishedAt: NOW,
        }}
        showWorkflow
        now={NOW}
        onOpen={() => {}}
      />,
    );

    expect(html).toContain("Deleted workflow");
    expect(html).not.toContain("/w/gone");
  });
});
