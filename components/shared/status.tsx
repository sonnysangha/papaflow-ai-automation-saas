import { cn } from "@/lib/utils";

/** `executions.status` — the six states a run can be in. */
export type RunStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
/** `workflows.status` — draft until published, paused when unpublished again. */
export type WorkflowStatus = "draft" | "active" | "paused";

type Tone = {
  label: string;
  /** The dot. */
  dot: string;
  /** Text colour, light and dark. */
  text: string;
  /** Tinted background, light and dark. */
  bg: string;
  pulse?: boolean;
};

/**
 * The one palette for run states, used by every list, badge and timeline: emerald finished,
 * amber running, sky waiting on a person or a callback, red failed, zinc for the rest.
 */
export const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  queued: {
    label: "Queued",
    dot: "bg-zinc-400",
    text: "text-zinc-600 dark:text-zinc-300",
    bg: "bg-zinc-500/15",
  },
  running: {
    label: "Running",
    dot: "bg-amber-400",
    text: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/15",
    pulse: true,
  },
  waiting: {
    label: "Waiting",
    dot: "bg-sky-400",
    text: "text-sky-700 dark:text-sky-300",
    bg: "bg-sky-500/15",
  },
  completed: {
    label: "Completed",
    dot: "bg-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/15",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-400",
    text: "text-red-700 dark:text-red-300",
    bg: "bg-red-500/15",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-zinc-500",
    text: "text-zinc-500 dark:text-zinc-400",
    bg: "bg-zinc-500/10",
  },
};

export const WORKFLOW_STATUS_TONE: Record<WorkflowStatus, Tone> = {
  draft: {
    label: "Draft",
    dot: "bg-zinc-400",
    text: "text-zinc-600 dark:text-zinc-300",
    bg: "bg-zinc-500/15",
  },
  active: {
    label: "Published",
    dot: "bg-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/15",
  },
  paused: {
    label: "Paused",
    dot: "bg-amber-400",
    text: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/15",
  },
};

/** A status pill: tinted background, a dot (pulsing while running) and the label. */
function Pill({
  tone,
  size,
  className,
  label,
}: {
  tone: Tone;
  size: "sm" | "md";
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
        tone.bg,
        tone.text,
        className,
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", tone.dot, tone.pulse && "animate-pulse")}
        aria-hidden
      />
      {label ?? tone.label}
    </span>
  );
}

export function RunStatusPill({
  status,
  size = "sm",
  className,
  label,
}: {
  status: RunStatus | string;
  size?: "sm" | "md";
  className?: string;
  /** Overrides the default label, e.g. "Waiting for approval". */
  label?: string;
}) {
  const tone = RUN_STATUS_TONE[status as RunStatus] ?? RUN_STATUS_TONE.queued;
  return <Pill tone={tone} size={size} className={className} label={label} />;
}

export function WorkflowStatusPill({
  status,
  size = "sm",
  className,
}: {
  status: WorkflowStatus | string;
  size?: "sm" | "md";
  className?: string;
}) {
  const tone = WORKFLOW_STATUS_TONE[status as WorkflowStatus] ?? WORKFLOW_STATUS_TONE.draft;
  return <Pill tone={tone} size={size} className={className} />;
}

/** Just the dot, for dense places like an activity strip. */
export function RunStatusDot({
  status,
  className,
  title,
}: {
  status: RunStatus | string;
  className?: string;
  title?: string;
}) {
  const tone = RUN_STATUS_TONE[status as RunStatus] ?? RUN_STATUS_TONE.queued;
  return (
    <span
      className={cn("inline-block size-2 rounded-full", tone.dot, tone.pulse && "animate-pulse", className)}
      title={title ?? tone.label}
      role="img"
      aria-label={title ?? tone.label}
    />
  );
}
