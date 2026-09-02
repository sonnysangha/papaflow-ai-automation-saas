import { cn } from "@/lib/utils";
import type { NodeStatus } from "./graph-io";

const STATUS: Record<NodeStatus, { label: string; className: string }> = {
  idle: { label: "Idle", className: "bg-muted-foreground/30 ring-muted-foreground/10" },
  running: { label: "Running", className: "animate-pulse bg-amber-500 ring-amber-500/25" },
  success: { label: "Success", className: "bg-emerald-500 ring-emerald-500/25" },
  failed: { label: "Failed", className: "bg-destructive ring-destructive/25" },
  waiting: { label: "Waiting", className: "bg-blue-500 ring-blue-500/25" },
  skipped: { label: "Skipped", className: "bg-muted-foreground/30 ring-muted-foreground/10" },
};

/**
 * The one dot that tells you what a node is doing. `data.status` comes from the latest run's
 * `steps` rows (see `Editor`), so it goes amber while a node runs and settles green, red or blue.
 * A node the run never reached is `skipped` — the same quiet grey as idle, since neither ran.
 */
export function StatusRing({ status = "idle", className }: { status?: NodeStatus; className?: string }) {
  const { label, className: tone } = STATUS[status];

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block size-2 shrink-0 rounded-full ring-3", tone, className)}
    />
  );
}
