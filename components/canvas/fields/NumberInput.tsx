"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";

export type NumberInputProps = {
  id: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** `z.int()` — the value is truncated on the way into the node. */
  integer?: boolean;
  placeholder?: string;
};

/**
 * A `z.number()` input. The text is held locally while it is being typed, because `-`, `1.` and
 * `1e` are all states on the way to a number that `Number()` would otherwise throw away; the node
 * is only written when the text is actually a number (or empty, which clears the field so the
 * schema's default applies again).
 */
export function NumberInput({ id, value, onChange, integer, placeholder }: NumberInputProps) {
  const [text, setText] = useState(() => (value === undefined ? "" : String(value)));

  return (
    <Input
      id={id}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      step={integer ? 1 : "any"}
      value={text}
      placeholder={placeholder}
      className="font-mono text-xs"
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim().length === 0) {
          onChange(undefined);
          return;
        }
        const parsed = Number(next);
        if (Number.isFinite(parsed)) onChange(integer ? Math.trunc(parsed) : parsed);
      }}
    />
  );
}
