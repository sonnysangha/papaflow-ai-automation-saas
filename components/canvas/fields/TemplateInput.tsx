"use client";

import { useCallback, useEffect, useRef } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { VariablePicker } from "../VariablePicker";
import type { VariableGroup } from "../variables";

export type TemplateInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  groups: VariableGroup[];
  /** Renders a Textarea instead of an Input — long bodies, prompts and JSON samples. */
  multiline?: boolean;
  placeholder?: string;
};

/**
 * A string field that may hold `{{ template }}` references. The `{}` button opens the variable
 * picker and drops the chosen path in at the caret, which is why the field keeps a ref: an
 * `<input>` remembers its selection while the popover has focus, so the insert lands where the
 * user was typing rather than at the end.
 */
export function TemplateInput({
  id,
  value,
  onChange,
  groups,
  multiline,
  placeholder,
}: TemplateInputProps) {
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);

  const setField = useCallback((field: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRef.current = field;
  }, []);

  // The caret can only be moved after React has rendered the new value, and only after the
  // popover has handed focus back — hence the frame rather than a plain effect body.
  useEffect(() => {
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    const frame = requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const insert = useCallback(
    (template: string) => {
      const field = fieldRef.current;
      const start = field?.selectionStart ?? value.length;
      const end = field?.selectionEnd ?? value.length;
      caretRef.current = start + template.length;
      onChange(`${value.slice(0, start)}${template}${value.slice(end)}`);
    },
    [onChange, value],
  );

  const shared = {
    id,
    ref: setField,
    value,
    placeholder,
    spellCheck: false,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    className: cn("font-mono text-xs", multiline && "min-h-20"),
  };

  return (
    <div className="flex items-start gap-1.5">
      {multiline ? <Textarea {...shared} rows={4} /> : <Input {...shared} />}
      <VariablePicker groups={groups} onInsert={insert} finalFocus={fieldRef} />
    </div>
  );
}
