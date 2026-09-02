"use client";

import { Switch } from "@/components/ui/switch";

export type BooleanSwitchProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Sits next to the switch; the field's own label is above it. */
  hint?: string;
};

/** A `z.boolean()` input. */
export function BooleanSwitch({ id, checked, onChange, hint }: BooleanSwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={(next) => onChange(next)} />
      <span className="text-xs text-muted-foreground">{hint ?? (checked ? "On" : "Off")}</span>
    </div>
  );
}
