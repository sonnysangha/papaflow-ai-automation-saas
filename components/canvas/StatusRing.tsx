import { cn } from "@/lib/utils";
import type { NodeStatus } from "./graph-io";

const STATUS: Record<NodeStatus, { label: string; className: string }> = {
  idle: { label: "Idle", className: "bg-muted-foreground/30 ring-muted-foreground/10" },
  running: { label: "Running", className: "animate-pulse bg-amber-500 ring-amber-500/25" },
  success: { label: "Success", className: "bg-emerald-500 ring-emerald-500/25" },
  failed: { label: "Failed", className: "bg-destructive ring-destructive/25" },
  waiting: { label: "Waiting", className: "bg-blue-500 ring-blue-500/25" },
};

/**
 * The one dot that tells you what a node is doing. Idle until Phase 2 wires `steps` into
 * `data.status`, so today it reads as a quiet bullet in front of the node label.
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
