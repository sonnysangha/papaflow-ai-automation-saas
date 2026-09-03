"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { EnumOption } from "../field-label";

export type EnumSelectProps = {
  id: string;
  value: string | undefined;
  /**
   * The choices, in the schema's order. `value` is what the graph stores and `label` is what the
   * reader sees — the two differ only where the node declared `.meta({ options })`, which is how
   * Condition offers "is greater than" for the stored `greaterThan`.
   */
  options: readonly EnumOption[];
  onChange: (value: string) => void;
  placeholder?: string;
};

/** A `z.enum()` input: HTTP method, comparison operator, model name. */
export function EnumSelect({ id, value, options, onChange, placeholder }: EnumSelectProps) {
  const empty = placeholder ?? "Choose…";

  return (
    // `null` rather than `undefined`: an undefined value would make the select uncontrolled.
    <Select
      value={value ?? null}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <SelectTrigger id={id} className="w-full">
        {/* Without children the trigger shows the *stored* value, which is the one thing a
            relabelled enum must not do. A value no longer in the list still shows as itself —
            better a stale `greaterThan` than a box that looks empty. */}
        <SelectValue placeholder={empty}>
          {(current: unknown) => {
            if (typeof current !== "string" || current.length === 0) return empty;
            return options.find((option) => option.value === current)?.label ?? current;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
