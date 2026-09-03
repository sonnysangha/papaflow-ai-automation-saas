"use client";

import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TagListProps = {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Shown in place of the empty list; Switch calls its entries "cases", not "items". */
  addLabel?: string;
};

/**
 * An array of strings — Switch's `cases`, a list of tags. Rows stay editable rather than
 * collapsing into badges: a case you mistyped is one keystroke from correct, and the order of
 * the list is the order of the node's handles.
 */
export function TagList({ id, value, onChange, placeholder, addLabel = "Add item" }: TagListProps) {
  const replace = (index: number, entry: string) =>
    onChange(value.map((current, at) => (at === index ? entry : current)));

  return (
    <div className="min-w-0 space-y-1.5">
      {/* Index keys: the rows are positional and have no id of their own — editing one rewrites
          that position, and adding or removing always happens at the end or by index. */}
      {value.map((entry, index) => (
        <div key={index} className="flex min-w-0 items-center gap-1.5">
          <Input
            id={index === 0 ? id : undefined}
            value={entry}
            placeholder={placeholder}
            spellCheck={false}
            aria-label={`Item ${index + 1}`}
            className="font-mono text-xs"
            onChange={(event) => replace(index, event.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove item ${index + 1}`}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, ""])}
        className="w-full"
      >
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  );
}
