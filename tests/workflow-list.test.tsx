import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkflowRow, WorkflowToolbar, type Workflow } from "@/components/workflows/WorkflowList";
import {
  activityCaption,
  filterWorkflows,
  formatCountdown,
  formatRunDuration,
  nextRunLabel,
  statusCounts,
  WORKFLOW_FILTERS,
} from "@/components/workflows/workflow-list";

/**
 * The workflow list, in the two halves that can be checked without a browser: the arithmetic behind
 * the toolbar, and the markup of one row.
 *
 * The row is the page's whole claim — what this workflow is, whether it is live, how the last run
 * went — so the smoke test is about the claim being *made*, in the shared vocabulary the runs pages
 * use, rather than about how it is styled.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const rows = [
  { name: "Support autopilot", status: "active" },
  { name: "Weekly digest", status: "draft" },
  { name: "Stripe receipts", status: "paused" },
  { name: "SUPPORT escalation", status: "active" },
];

describe("filterWorkflows", () => {
  it("matches the name case-insensitively, ignoring surrounding space", () => {
    const names = (query: string) =>
      filterWorkflows(rows, { query, status: "all" }).map((row) => row.name);

    expect(names("support")).toEqual(["Support autopilot", "SUPPORT escalation"]);
    expect(names("  digest  ")).toEqual(["Weekly digest"]);
    expect(names("")).toHaveLength(4);
    expect(names("nothing")).toEqual([]);
  });

  it("narrows to one status, and combines the two", () => {
    expect(filterWorkflows(rows, { query: "", status: "active" })).toHaveLength(2);
    expect(filterWorkflows(rows, { query: "", status: "paused" })).toHaveLength(1);
    expect(
      filterWorkflows(rows, { query: "support", status: "draft" }),
    ).toEqual([]);
  });

  it("keeps the order it was given, which is newest-updated first", () => {
    expect(filterWorkflows(rows, { query: "t", status: "all" }).map((row) => row.name)).toEqual([
      "Support autopilot",
      "Weekly digest",
      "Stripe receipts",
      "SUPPORT escalation",
    ]);
  });
});

describe("statusCounts", () => {
  it("counts each chip, with all as the total", () => {
    expect(statusCounts(rows)).toEqual({ all: 4, active: 2, draft: 1, paused: 1 });
    expect(statusCounts([])).toEqual({ all: 0, active: 0, draft: 0, paused: 0 });
  });

  it("has a count for every chip the toolbar draws", () => {
    const counts = statusCounts(rows);
    for (const filter of WORKFLOW_FILTERS) {
      expect(counts[filter.value]).toBeTypeOf("number");
    }
  });
});

describe("formatRunDuration", () => {
  it("keeps a sub-second run sub-second", () => {
    expect(formatRunDuration(0, 840)).toBe("840ms");
    expect(formatRunDuration(0, 999)).toBe("999ms");
  });

  it("shows one decimal under ten seconds and whole seconds above", () => {
    expect(formatRunDuration(0, 1_400)).toBe("1.4s");
    expect(formatRunDuration(0, 35_000)).toBe("35s");
  });

  it("splits minutes and hours", () => {
    expect(formatRunDuration(0, 2 * MINUTE + 5_000)).toBe("2m 5s");
    expect(formatRunDuration(0, 3 * MINUTE)).toBe("3m");
    expect(formatRunDuration(0, HOUR + 4 * MINUTE)).toBe("1h 4m");
    expect(formatRunDuration(0, 2 * HOUR)).toBe("2h");
  });

  it("has no duration for a run that has not finished", () => {
    expect(formatRunDuration(0, undefined)).toBeNull();
  });
});

describe("nextRunLabel", () => {
  it("counts down to the armed occurrence", () => {
    expect(nextRunLabel({ cron: "0 * * * *", nextAt: 2 * HOUR }, 0)).toBe("Next run in 2h");
    expect(nextRunLabel({ cron: "0 * * * *", nextAt: 40 * MINUTE }, 0)).toBe("Next run in 40m");
    expect(nextRunLabel({ cron: "0 * * * *", nextAt: 30_000 }, 0)).toBe(
      "Next run in under a minute",
    );
  });

  it("falls back to the cron itself when nothing is armed, or the time has passed", () => {
    expect(nextRunLabel({ cron: "0 9 * * *" }, 0)).toBe("every day at 09:00");
    expect(nextRunLabel({ cron: "0 * * * *", nextAt: 0 }, HOUR)).toBe("every hour");
  });

  it("rounds a countdown down, never up", () => {
    expect(formatCountdown(HOUR - 1)).toBe("59m");
    expect(formatCountdown(47 * HOUR)).toBe("1d");
  });
});

describe("activityCaption", () => {
  it("pluralises the week's runs", () => {
    expect(activityCaption(0)).toBe("0 runs · 7d");
    expect(activityCaption(1)).toBe("1 run · 7d");
    expect(activityCaption(12)).toBe("12 runs · 7d");
  });
});

const NOW = 1_700_000_000_000;

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    _id: "wf_1" as Workflow["_id"],
    _creationTime: NOW - 10 * HOUR,
    name: "Support autopilot",
    status: "active",
    version: 3,
    updatedAt: NOW - 2 * HOUR,
    schedule: null,
    triggerNodeType: "telegram.message",
    lastRun: {
      status: "failed",
      startedAt: NOW - 5 * MINUTE,
      finishedAt: NOW - 5 * MINUTE + 2_400,
      error: "Telegram said no",
    },
    recentRuns: [
      { status: "failed", startedAt: NOW - 5 * MINUTE, finishedAt: NOW - 5 * MINUTE + 2_400 },
      { status: "completed", startedAt: NOW - 3 * HOUR, finishedAt: NOW - 3 * HOUR + 900 },
    ],
    runCount7d: 2,
    ...overrides,
  };
}

/** A `<tr>` is only legal inside a table, and `renderToStaticMarkup` is happy to be told so. */
function renderRow(row: Workflow) {
  return renderToStaticMarkup(
    <table>
      <tbody>
        <WorkflowRow
          workflow={row}
          now={NOW}
          onOpen={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
        />
      </tbody>
    </table>,
  );
}

describe("WorkflowToolbar", () => {
  it("names every filter and shows what each one holds", () => {
    const html = renderToStaticMarkup(
      <WorkflowToolbar
        query=""
        onQueryChange={() => {}}
        status="all"
        onStatusChange={() => {}}
        counts={{ all: 4, active: 2, draft: 1, paused: 1 }}
        actions={<button type="button">New workflow</button>}
      />,
    );

    expect(html).toContain("Search workflows");
    for (const filter of WORKFLOW_FILTERS) expect(html).toContain(filter.label);
    expect(html).toContain("4 workflows");
    expect(html).toContain("New workflow");
    // The chip that is on says so to a screen reader, not only in colour.
    expect(html).toContain('aria-pressed="true"');
  });

  it("waits for the count rather than claiming zero while the query is in flight", () => {
    const html = renderToStaticMarkup(
      <WorkflowToolbar
        query=""
        onQueryChange={() => {}}
        status="all"
        onStatusChange={() => {}}
        counts={{ all: 0, active: 0, draft: 0, paused: 0 }}
        loading
      />,
    );

    expect(html).not.toContain("0 workflows");
    expect(html).toContain("disabled");
  });
});

describe("WorkflowRow", () => {
  it("shows the trigger, the status and the last run", () => {
    const html = renderRow(workflow());

    expect(html).toContain("Support autopilot");
    // The shared chip and pill, in the words the runs pages use.
    expect(html).toContain("Telegram");
    expect(html).toContain("Published");
    expect(html).toContain("Failed");
    expect(html).toContain("2.4s");
    expect(html).toContain("2 runs · 7d");
    // Name to the canvas, last run to that workflow's history.
    expect(html).toContain('href="/w/wf_1"');
    expect(html).toContain('href="/w/wf_1/runs"');
    expect(html).toContain("Actions for Support autopilot");
  });

  it("says so plainly when a workflow has never run", () => {
    const html = renderRow(workflow({ lastRun: null, recentRuns: [], runCount7d: 0 }));

    expect(html).toContain("Never run");
    expect(html).toContain("No runs yet");
    expect(html).not.toContain("runs · 7d");
  });

  it("puts the next occurrence under the name of a scheduled workflow", () => {
    const html = renderRow(
      workflow({ schedule: { cron: "0 9 * * *", nextAt: NOW + 2 * HOUR } }),
    );

    expect(html).toContain("Next run in 2h");
    expect(html).toContain("0 9 * * *");
  });

  it("draws the activity strip oldest first", () => {
    // Convex hands the runs over newest first; the strip has to turn them round.
    const html = renderRow(
      workflow({
        recentRuns: [
          { status: "failed", startedAt: NOW - 5 * MINUTE, finishedAt: NOW - 5 * MINUTE + 900 },
          { status: "completed", startedAt: NOW - 3 * HOUR, finishedAt: NOW - 3 * HOUR + 900 },
          { status: "cancelled", startedAt: NOW - 9 * HOUR, finishedAt: undefined },
        ],
        runCount7d: 3,
      }),
    );

    // "Cancelled" appears nowhere else in the row, so its position is the strip's left edge; the
    // last "Failed" is the strip's right edge (the first one is the Last run column's own dot).
    const cancelled = html.indexOf('aria-label="Cancelled');
    const completed = html.indexOf('aria-label="Completed');
    const failed = html.lastIndexOf('aria-label="Failed');

    expect(cancelled).toBeGreaterThan(-1);
    expect(cancelled).toBeLessThan(completed);
    expect(completed).toBeLessThan(failed);
  });
});
