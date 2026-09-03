/**
 * What kind of trigger started a run, or heads a workflow — one vocabulary for both.
 *
 * Executions record `trigger.type` as a short word (`"manual"`, `"form"`, …, set by the route or
 * action that started the run), while a workflow's graph knows its trigger only as a node type
 * (`"form.trigger"`, `"telegram.message"`, …). Both spellings map onto the same {@link TriggerKind}
 * so a list row and a run row can show the same chip for the same thing.
 */
export type TriggerKind =
  | "manual"
  | "form"
  | "webhook"
  | "schedule"
  | "telegram"
  | "stripe"
  | "unknown";

const BY_TYPE: Record<string, TriggerKind> = {
  manual: "manual",
  "manual.trigger": "manual",
  form: "form",
  "form.trigger": "form",
  webhook: "webhook",
  "webhook.trigger": "webhook",
  schedule: "schedule",
  "schedule.trigger": "schedule",
  telegram: "telegram",
  "telegram.message": "telegram",
  stripe: "stripe",
  "stripe.event": "stripe",
};

/** The trigger kind for an execution's `trigger.type` or a trigger node's `nodeType`. */
export function triggerKind(type: string | null | undefined): TriggerKind {
  if (!type) return "unknown";
  return BY_TYPE[type] ?? BY_TYPE[type.toLowerCase()] ?? "unknown";
}

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  manual: "Manual",
  form: "Form",
  webhook: "Webhook",
  schedule: "Schedule",
  telegram: "Telegram",
  stripe: "Stripe",
  unknown: "Trigger",
};

/** One-line explanation for tooltips and empty states. */
export const TRIGGER_HINT: Record<TriggerKind, string> = {
  manual: "Started by pressing Run",
  form: "Started by a form submission",
  webhook: "Started by an HTTP request to the webhook URL",
  schedule: "Started on a schedule",
  telegram: "Started by a Telegram message",
  stripe: "Started by a Stripe event",
  unknown: "Started by a trigger",
};
