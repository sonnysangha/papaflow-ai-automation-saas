"use client";

import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { VariableGroup } from "../variables";
import { TemplateInput } from "./TemplateInput";

export type KeyValuePair = { key: string; value: string };

export type KeyValueProps = {
  id: string;
  value: KeyValuePair[];
  onChange: (value: KeyValuePair[]) => void;
  groups: VariableGroup[];
  addLabel?: string;
  /** What the two columns are called. "Name"/"Value" reads for both a Set field and a header. */
  keyLabel?: string;
  valueLabel?: string;
};

/**
 * An array of `{ key, value }` — the Set node's fields. The value half is a `TemplateInput`, so
 * `{{ http_request_1.body.id }}` can be picked rather than typed, and a value that is nothing but
 * a template keeps its real type when the engine resolves it.
 */
export function KeyValueList({
  id,
  value,
  onChange,
  groups,
  addLabel = "Add field",
  keyLabel = "Name",
  valueLabel = "Value",
}: KeyValueProps) {
  const replace = (index: number, pair: KeyValuePair) =>
    onChange(value.map((current, at) => (at === index ? pair : current)));

  return (
    <div className="space-y-1.5">
      {/* Which box is which, once there is a box to mislabel. The row's own `aria-label` already
          says it; this is the same answer for someone reading rather than tabbing. */}
      {value.length > 0 ? (
        <div aria-hidden className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-28 shrink-0">{keyLabel}</span>
          <span className="min-w-0 flex-1">{valueLabel}</span>
          {/* Keeps the two captions over their columns rather than under the remove button. */}
          <span className="size-8 shrink-0" />
        </div>
      ) : null}

      {/* Index keys: rows are positional, and editing one rewrites that position in place. */}
      {value.map((pair, index) => (
        <div key={index} className="flex items-start gap-1.5">
          <Input
            id={index === 0 ? id : undefined}
            value={pair.key}
            placeholder="name"
            spellCheck={false}
            aria-label={`Field ${index + 1} name`}
            className="w-28 shrink-0 font-mono text-xs"
            onChange={(event) => replace(index, { ...pair, key: event.target.value })}
          />
          <div className="min-w-0 flex-1">
            <TemplateInput
              id={`${id}-value-${index}`}
              value={pair.value}
              groups={groups}
              placeholder="value or {{ template }}"
              onChange={(next) => replace(index, { ...pair, value: next })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove field ${index + 1}`}
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
        onClick={() => onChange([...value, { key: "", value: "" }])}
        className="w-full"
      >
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  );
}
