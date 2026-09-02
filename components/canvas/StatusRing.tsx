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

/** How a status reads in a sentence — the tooltip on a node, and the label on the dot itself. */
export function statusLabel(status: NodeStatus = "idle"): string {
  return STATUS[status].label;
}

/**
 * "Success · 1.2s", or just the status while a step is still going. The one line the canvas
 * tooltip shows, so a node answers "did it work, and how long did it take" without opening a run.
 */
export function statusSummary(status: NodeStatus | undefined, durationMs: number | undefined): string {
  const label = statusLabel(status);
  if (durationMs === undefined || !Number.isFinite(durationMs)) return label;

  const ms = Math.max(0, Math.round(durationMs));
  if (ms < 1_000) return `${label} · ${ms}ms`;
  if (ms < 60_000) return `${label} · ${(ms / 1_000).toFixed(1)}s`;
  return `${label} · ${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

/**
 * The one dot that tells you what a node is doing. `data.status` comes from the latest run's
 * `steps` rows (see `Editor`), so it goes amber while a node runs and settles green, red or blue.
 * A node the run never reached is `skipped` — the same quiet grey as idle, since neither ran.
 *
 * Colour is the only thing that carries the meaning, so the dot also names itself: `aria-label`
 * for a screen reader, `title` for anyone who cannot tell amber from emerald. On the canvas the
 * whole node carries the richer "Success · 1.2s" tooltip instead, and passes `labelled={false}` so
 * the two do not stack up on top of each other.
 */
export function StatusRing({
  status = "idle",
  labelled = true,
  className,
}: {
  status?: NodeStatus;
  /** Set to false when an ancestor already names the status — the canvas node does. */
  labelled?: boolean;
  className?: string;
}) {
  const { label, className: tone } = STATUS[status];

  return (
    <span
      role={labelled ? "img" : "presentation"}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      title={labelled ? label : undefined}
      className={cn("inline-block size-2 shrink-0 rounded-full ring-3", tone, className)}
    />
  );
}
