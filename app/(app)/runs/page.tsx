import type { Metadata } from "next";

import { OrgRunsTable } from "@/components/runs/RunsTable";

export const metadata: Metadata = {
  title: "Runs",
};

/**
 * Every run this organisation has started, across all its workflows. The org guard lives in
 * `app/(app)/layout.tsx`; the table itself is a client component so it subscribes to Convex and a
 * run started anywhere in the workspace appears without a reload.
 *
 * How far back it goes is the plan's business: `executions.listByOrg` windows the `by_org_started`
 * scan to 7 days, or 30 with `run_history_30d`, and says whether anything older exists.
 */
export default function OrgRunsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          Every run this organisation has started, newest first. Open one to see what each node did.
        </p>
      </div>

      <OrgRunsTable />
    </div>
  );
}
