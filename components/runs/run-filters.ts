// Narrowing a page of runs down to the one you are looking for. Pure, so the filter row is markup
// and every combination has a test.
//
// Filtering is client-side on purpose: the rows are already loaded and live, so a status chip is
// instant and a run that changes status while you watch moves in or out of the filter by itself. It
// only ever narrows what has been loaded — the footer under the table says how much that is.
import type { RunStatus } from "@/components/shared/status";

/** The sentinel every "no opinion" filter carries, so a Select can hold a real string value. */
export const ANY = "all";

export type RunFilters = {
  /** A run status, or `all`. */
  status: string;
  /** An execution's `trigger.type` (`manual`, `webhook`, …), or `all`. */
  trigger: string;
  /** A workflow id, or `all`. Only the org-wide page offers it. */
  workflow: string;
  /** Free text, matched against the workflow's name and the run's error. */
  text: string;
};

export const NO_FILTERS: RunFilters = { status: ANY, trigger: ANY, workflow: ANY, text: "" };

/** The chips the filter row offers, in the order it reads best. */
export const STATUS_FILTERS: readonly RunStatus[] = [
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
];

/** The columns a filter reads. Both the projected list row and `Doc<"executions">` satisfy it. */
export type FilterableRun = {
  status: string;
  trigger: { type: string };
  workflowId: string;
  error?: string;
};

/** Whether anything is narrowing the list — what turns the "Clear" button on. */
export function isFiltered(filters: RunFilters): boolean {
  return (
    filters.status !== ANY ||
    filters.trigger !== ANY ||
    filters.workflow !== ANY ||
    filters.text.trim().length > 0
  );
}

/**
 * The rows that match every active filter.
 *
 * `workflowNames` is what makes the text box useful on the org-wide page: a run stores an id, and
 * "invoice" is what somebody actually types. A workflow that has since been deleted has no name to
 * match, so it only ever comes back under an empty search.
 */
export function filterRuns<T extends FilterableRun>(
  runs: readonly T[],
  filters: RunFilters,
  workflowNames: Record<string, string> = {},
): T[] {
  const needle = filters.text.trim().toLowerCase();

  return runs.filter((run) => {
    if (filters.status !== ANY && run.status !== filters.status) return false;
    if (filters.trigger !== ANY && run.trigger.type !== filters.trigger) return false;
    if (filters.workflow !== ANY && run.workflowId !== filters.workflow) return false;
    if (needle.length === 0) return true;

    const haystack = `${workflowNames[run.workflowId] ?? ""} ${run.error ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

/** How many runs each status has on this page, plus `all`. A chip with none is not drawn. */
export function statusCounts(runs: readonly FilterableRun[]): Record<string, number> {
  const counts: Record<string, number> = { [ANY]: runs.length };
  for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1;
  return counts;
}

/** The trigger types actually present, alphabetically — the Select never offers an empty option. */
export function triggerOptions(runs: readonly FilterableRun[]): string[] {
  return [...new Set(runs.map((run) => run.trigger.type))].sort();
}
