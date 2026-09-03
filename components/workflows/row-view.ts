// What one workflow says about itself, worked out once and rendered twice.
//
// The list is a table from `md` up and a stack of cards below it, and the two must agree about
// every string on them — the countdown under a scheduled name, the age of the last run, the title
// on a status dot. So the strings are made here and both renderers are markup over the same object.

import { RUN_STATUS_TONE, type RunStatus } from "@/components/shared/status";

import { formatAbsoluteTime, formatRelativeTime } from "./relative-time";
import { activityCaption, formatRunDuration, nextRunLabel } from "./workflow-list";

/** A run as the list draws it: a coloured dot with a title, and (for the last one) a duration. */
export type RunDotView = { status: string; title: string };

/** The little of a row this file needs — `api.workflows.list`'s projection satisfies it. */
export type ViewableWorkflow = {
  _id: string;
  name: string;
  status: string;
  updatedAt: number;
  triggerNodeType?: string | null;
  schedule?: { cron: string; nextAt?: number } | null;
  lastRun?: { status: string; startedAt: number; finishedAt?: number } | null;
  recentRuns: readonly { status: string; startedAt: number; finishedAt?: number }[];
  runCount7d: number;
};

export type WorkflowRowView = {
  /** The canvas. */
  href: string;
  /** This workflow's own run history. */
  runsHref: string;
  /** "Next run in 2h", or the cron itself. Null when nothing is scheduled. */
  schedule: { label: string; cron: string } | null;
  lastRun: (RunDotView & { relative: string; duration: string | null }) | null;
  /** Oldest first, so the strip reads forwards in time like everything else. */
  recentRuns: RunDotView[];
  /** "3 runs · 7d", or null when nothing has run. */
  activity: string | null;
  updated: string;
  updatedTitle: string;
  /** The accessible name of the row's actions menu. */
  menuLabel: string;
};

function dotTitle(status: string, startedAt: number): string {
  const tone = RUN_STATUS_TONE[status as RunStatus];
  return `${tone ? tone.label : status} · ${formatAbsoluteTime(startedAt)}`;
}

export function workflowRowView(workflow: ViewableWorkflow, now?: number): WorkflowRowView {
  const { lastRun, recentRuns, schedule } = workflow;

  return {
    href: `/w/${workflow._id}`,
    runsHref: `/w/${workflow._id}/runs`,
    schedule: schedule ? { label: nextRunLabel(schedule, now), cron: schedule.cron } : null,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          title: dotTitle(lastRun.status, lastRun.startedAt),
          relative: formatRelativeTime(lastRun.startedAt, now),
          duration: formatRunDuration(lastRun.startedAt, lastRun.finishedAt),
        }
      : null,
    recentRuns: [...recentRuns]
      .reverse()
      .map((run) => ({ status: run.status, title: dotTitle(run.status, run.startedAt) })),
    activity: recentRuns.length > 0 ? activityCaption(workflow.runCount7d) : null,
    updated: formatRelativeTime(workflow.updatedAt, now),
    updatedTitle: formatAbsoluteTime(workflow.updatedAt),
    menuLabel: `Actions for ${workflow.name}`,
  };
}
