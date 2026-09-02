"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type EnumSelectProps = {
  id: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
};

/** A `z.enum()` input: HTTP method, comparison operator, model name. */
export function EnumSelect({ id, value, options, onChange, placeholder }: EnumSelectProps) {
  return (
    // `null` rather than `undefined`: an undefined value would make the select uncontrolled.
    <Select
      value={value ?? null}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder ?? "Choose…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
