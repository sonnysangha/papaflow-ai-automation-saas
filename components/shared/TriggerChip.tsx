import {
  CalendarClock,
  ClipboardList,
  CreditCard,
  type LucideIcon,
  Play,
  Send,
  Webhook,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { TRIGGER_HINT, TRIGGER_LABEL, type TriggerKind, triggerKind } from "./trigger";

export const TRIGGER_ICON: Record<TriggerKind, LucideIcon> = {
  manual: Play,
  form: ClipboardList,
  webhook: Webhook,
  schedule: CalendarClock,
  telegram: Send,
  stripe: CreditCard,
  unknown: Zap,
};

/**
 * The small "how this started" chip shared by the workflow list and the runs pages.
 *
 * `type` accepts either spelling (`"form"` from an execution, `"form.trigger"` from a graph).
 */
export function TriggerChip({
  type,
  className,
  showLabel = true,
}: {
  type: string | null | undefined;
  className?: string;
  /** Icon-only when false — the label stays in the DOM for screen readers. */
  showLabel?: boolean;
}) {
  const kind = triggerKind(type);
  const Icon = TRIGGER_ICON[kind];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-muted/40 px-1.5 text-xs text-muted-foreground",
        className,
      )}
      title={TRIGGER_HINT[kind]}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {showLabel ? TRIGGER_LABEL[kind] : <span className="sr-only">{TRIGGER_LABEL[kind]}</span>}
    </span>
  );
}
