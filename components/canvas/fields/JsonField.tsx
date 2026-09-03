"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";

import { VariablePicker } from "../VariablePicker";
import type { VariableGroup } from "../variables";

/** Mirrors `WHOLE_TEMPLATE` in `nodes/templates.ts`: a value that is nothing but one reference. */
const WHOLE_TEMPLATE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

export type JsonFieldProps = {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  groups: VariableGroup[];
  placeholder?: string;
};

/** What the stored value looks like as text: a template stays itself, everything else is JSON. */
function toText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string" && WHOLE_TEMPLATE.test(value)) return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
}

/**
 * Objects, records and `z.any()` inputs — headers, a JSON body, anything the schema leaves open.
 * The textarea holds text while it is being typed and only writes to the node once the text
 * parses, so a half-finished object never reaches the graph. A value that is exactly one
 * template is stored as the string it is: the engine resolves it to the real object at run time,
 * where `JSON.parse` here would only see `{{ … }}`.
 */
export function JsonField({ id, value, onChange, groups, placeholder }: JsonFieldProps) {
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const [text, setText] = useState(() => toText(value));
  const [error, setError] = useState<string | null>(null);

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
  }, [text]);

  const edit = useCallback(
    (next: string) => {
      setText(next);
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        setError(null);
        onChange(undefined);
        return;
      }
      if (WHOLE_TEMPLATE.test(trimmed)) {
        setError(null);
        onChange(trimmed);
        return;
      }
      try {
        onChange(JSON.parse(trimmed));
        setError(null);
      } catch (parseError) {
        setError(parseError instanceof Error ? parseError.message : "Invalid JSON");
      }
    },
    [onChange],
  );

  const insert = useCallback(
    (template: string) => {
      const field = fieldRef.current;
      const start = field?.selectionStart ?? text.length;
      const end = field?.selectionEnd ?? text.length;
      caretRef.current = start + template.length;
      edit(`${text.slice(0, start)}${template}${text.slice(end)}`);
    },
    [edit, text],
  );

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5">
        <Textarea
          id={id}
          ref={fieldRef}
          rows={4}
          value={text}
          spellCheck={false}
          placeholder={placeholder ?? "{ }"}
          aria-invalid={error !== null || undefined}
          className="min-h-20 font-mono text-xs"
          onChange={(event) => edit(event.target.value)}
        />
        <VariablePicker groups={groups} onInsert={insert} finalFocus={fieldRef} />
      </div>
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
