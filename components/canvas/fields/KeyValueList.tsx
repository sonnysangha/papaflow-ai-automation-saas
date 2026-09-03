"use client";

import { useState } from "react";
import { ChevronsUpDownIcon, ListIcon, PencilIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  choicesForKey,
  firstUnusedKey,
  keyOptions,
  pickerOptions,
  type PickerOption,
} from "../picker-options";
import { missingHint } from "../picker-kind";
import type { VariableGroup } from "../variables";
import { VariablePicker } from "../VariablePicker";
import { TemplateInput } from "./TemplateInput";
import { useConnectionPick, type PickListing } from "./use-connection-pick";

export type KeyValuePair = { key: string; value: string };

/**
 * The remote list the key column is chosen from — an Airtable table's columns, a Notion data
 * source's writable properties. A node asks for one with `.meta({ keyPicker: "fields:{baseId}:{tableId}" })`
 * on the array input; the config panel resolves the `{sibling}` placeholders and hands the result
 * over already substituted.
 */
export type KeyPicker = {
  /** The resolved kind, sent to `/api/connections/:id/pick` verbatim. */
  kind: string;
  /** The node's chosen connection: the credential the list is read with, server-side. */
  connectionId: string;
  /** Sibling inputs the kind names that have no value yet — non-empty means "nothing to ask yet". */
  missing: string[];
};

export type KeyValueProps = {
  id: string;
  value: KeyValuePair[];
  onChange: (value: KeyValuePair[]) => void;
  groups: VariableGroup[];
  addLabel?: string;
  /** What the two columns are called. "Name"/"Value" reads for both a Set field and a header. */
  keyLabel?: string;
  valueLabel?: string;
  /** Turns the key column into a dropdown of real columns instead of a text box. */
  keyPicker?: KeyPicker;
};

/**
 * Which half of a row the user has taken off its dropdown. `undefined` means "follow the value" —
 * a template is typed, anything else is chosen — exactly like `PickerField`'s `typing`, so that
 * "Choose from list" can win back a field whose value happens to be a template.
 */
type RowMode = { key?: boolean; value?: boolean };

const NO_MODE: RowMode = {};

/** The `SelectItem` that means "let me type this instead", rather than a value anyone could store. */
const TYPE_IT = "\u0000type-it";

function isTemplate(value: string): boolean {
  return value.includes("{{");
}

/**
 * The key half of one row, as a searchable dropdown of the table's own columns.
 *
 * A Command in a Popover rather than a Select because these lists are long and the user knows the
 * column by name — Airtable tables routinely carry thirty fields. The two entries under the rule
 * are the ways out: a column this list does not know about (typed by hand), and a list that has
 * gone stale since the panel was opened.
 */
function KeyCombobox({
  id,
  index,
  value,
  options,
  listing,
  onPick,
  onType,
  onReload,
}: {
  id: string | undefined;
  index: number;
  value: string;
  options: PickerOption[];
  listing: PickListing;
  onPick: (key: string) => void;
  onType: () => void;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The stored key *is* the column name, so the trigger shows it rather than the option's label:
  // in a 128px control, "Custom: Status" truncates to something less useful than "Status". The
  // label — with its `Custom:` marker when it has one — is on the hover title instead.
  const label = options.find((option) => option.id === value)?.label ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      {/* `id` on the trigger rather than on the button it renders: Base UI owns the trigger's
          attributes, and this is the id the panel's `<Label htmlFor>` points at. */}
      <PopoverTrigger
        id={id}
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={`Field ${index + 1} name`}
            title={label || "Choose a field"}
            className="w-32 shrink-0 justify-between gap-1 px-2 font-mono text-xs font-normal"
          >
            <span className="min-w-0 truncate">
              {value || (listing.state === "loading" ? "Loading…" : "Choose…")}
            </span>
            <ChevronsUpDownIcon className="shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search fields" />
          <CommandList>
            <CommandEmpty className="text-muted-foreground">Nothing matches that.</CommandEmpty>

            {/* Not a `CommandEmpty`: the two entries below are always in the list, so cmdk never
                considers it empty. This is the state of the *columns*, which is what is missing. */}
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {listing.state === "failed"
                  ? listing.error
                  : listing.state === "loading"
                    ? "Loading…"
                    : "Every column is already used by another row."}
              </p>
            ) : null}

            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  keywords={option.label === option.id ? undefined : [option.label]}
                  onSelect={() => {
                    onPick(option.id);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate" title={option.label}>
                    {option.label}
                  </span>
                  {/* What the column accepts, in the provider's own word for it. A
                      `command-shortcut` is muted and also tells the row's tick to stay away. */}
                  {option.type ? (
                    <CommandShortcut className="tracking-normal">{option.type}</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup>
              <CommandItem
                value="type a custom field name"
                onSelect={() => {
                  onType();
                  setOpen(false);
                }}
              >
                <PencilIcon />
                Custom…
              </CommandItem>
              <CommandItem
                value="reload the field list"
                onSelect={() => {
                  onReload();
                  setOpen(false);
                }}
              >
                <RefreshCwIcon />
                Reload list
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The value half of a row whose column only accepts certain words — an Airtable `singleSelect`, a
 * Notion `status`. The `{}` button stays: inserting a variable makes the value a template, which
 * is what flips the row back to a text field on the next render.
 */
function ChoiceValue({
  id,
  index,
  value,
  choices,
  groups,
  onChange,
  onType,
}: {
  id: string;
  index: number;
  value: string;
  choices: string[];
  groups: VariableGroup[];
  onChange: (value: string) => void;
  onType: () => void;
}) {
  // A value the column no longer offers is kept and marked, the same way every other picker keeps
  // one: an option renamed in Airtable must not silently empty a workflow that ran yesterday.
  const options = pickerOptions(
    choices.map((choice) => ({ id: choice, label: choice })),
    value,
  );

  return (
    <div className="flex min-w-0 flex-1 items-start gap-1.5">
      <Select
        value={value || null}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          if (next === TYPE_IT) onType();
          else onChange(next);
        }}
      >
        <SelectTrigger id={id} aria-label={`Field ${index + 1} value`} className="min-w-0 flex-1">
          <SelectValue>
            {(current: unknown) =>
              typeof current === "string" && current.length > 0
                ? (options.find((option) => option.id === current)?.label ?? current)
                : "Choose…"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value={TYPE_IT}>Custom…</SelectItem>
        </SelectContent>
      </Select>
      <VariablePicker groups={groups} onInsert={onChange} />
    </div>
  );
}

/**
 * An array of `{ key, value }` — the Set node's fields, an Airtable record's columns, a Notion
 * page's properties. The value half is a `TemplateInput`, so `{{ http_request_1.body.id }}` can be
 * picked rather than typed, and a value that is nothing but a template keeps its real type when
 * the engine resolves it.
 *
 * With a `keyPicker` the key half stops being a text box: writing to an Airtable column means
 * spelling its name exactly, and a typo is a 422 the user only finds out about at run time. The
 * list is read once here rather than once per row — every row's dropdown is the same list — and
 * the value half follows the column that was chosen: a `singleSelect` gets its own options.
 */
export function KeyValueList({
  id,
  value,
  onChange,
  groups,
  addLabel = "Add field",
  keyLabel = "Name",
  valueLabel = "Value",
  keyPicker,
}: KeyValueProps) {
  // One request per node, not per row. `disabled` covers both "this input has no picker" and "the
  // table it hangs off is still unchosen", in which case the kind would name half a list.
  const waiting = keyPicker !== undefined && keyPicker.missing.length > 0;
  const { listing, loaded, reload } = useConnectionPick(
    keyPicker?.connectionId ?? "",
    keyPicker?.kind ?? "",
    keyPicker === undefined || waiting,
  );

  // Positional, like the rows themselves, and kept in step with them on add and remove — otherwise
  // deleting row 1 would hand row 2 the mode row 1 was in.
  const [modes, setModes] = useState<readonly RowMode[]>([]);

  const replace = (index: number, pair: KeyValuePair) =>
    onChange(value.map((current, at) => (at === index ? pair : current)));

  const setMode = (index: number, patch: RowMode) =>
    setModes((rows) => {
      const next = [...rows];
      while (next.length <= index) next.push(NO_MODE);
      next[index] = { ...(next[index] ?? NO_MODE), ...patch };
      return next;
    });

  const usedKeys = value.map((pair) => pair.key);
  const keyWidth = keyPicker ? "w-32" : "w-28";
  const waitingFor = waiting ? missingHint(keyPicker.missing) : undefined;

  return (
    <div className="space-y-1.5">
      {/* Which box is which, once there is a box to mislabel. The row's own `aria-label` already
          says it; this is the same answer for someone reading rather than tabbing. */}
      {value.length > 0 ? (
        <div aria-hidden className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`${keyWidth} shrink-0`}>{keyLabel}</span>
          <span className="min-w-0 flex-1">{valueLabel}</span>
          {/* Keeps the two captions over their columns rather than under the remove button. */}
          <span className="size-8 shrink-0" />
        </div>
      ) : null}

      {/* Index keys: rows are positional, and editing one rewrites that position in place. */}
      {value.map((pair, index) => {
        const mode = modes[index] ?? NO_MODE;
        const fieldId = index === 0 ? id : undefined;
        const typedKey = mode.key ?? isTemplate(pair.key);
        // Only a column the list actually described constrains its value; everything else, and
        // everything before the list arrives, is the text field it has always been.
        const choices = keyPicker ? choicesForKey(loaded, pair.key) : null;
        const typedValue = mode.value ?? isTemplate(pair.value);

        return (
          <div key={index} className="flex items-start gap-1.5">
            {waiting ? (
              // Rendered as the control it is about to become rather than as a text box, so the
              // row does not reflow the moment the table is chosen — and carrying its reason,
              // because an empty disabled dropdown just reads as broken.
              <div
                id={fieldId}
                role="button"
                aria-disabled
                aria-label={waitingFor}
                title={waitingFor}
                className={`${keyWidth} flex h-9 shrink-0 items-center rounded-md border border-input bg-muted/40 px-2 text-xs text-muted-foreground`}
              >
                <span className="truncate">{waitingFor}</span>
              </div>
            ) : keyPicker && !typedKey ? (
              <KeyCombobox
                id={fieldId}
                index={index}
                value={pair.key}
                // A key another row already holds is not offered: writing the same column twice is
                // never the intent, and the second row would silently win.
                options={keyOptions(loaded, usedKeys, pair.key)}
                listing={listing}
                onPick={(key) => replace(index, { ...pair, key })}
                onType={() => setMode(index, { key: true })}
                onReload={reload}
              />
            ) : (
              <div className={`${keyWidth} flex shrink-0 items-start gap-1.5`}>
                <Input
                  id={fieldId}
                  value={pair.key}
                  placeholder="name"
                  spellCheck={false}
                  aria-label={`Field ${index + 1} name`}
                  className="min-w-0 flex-1 font-mono text-xs"
                  onChange={(event) => replace(index, { ...pair, key: event.target.value })}
                />
                {keyPicker ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Choose field ${index + 1} from the list`}
                    title="Choose from list"
                    onClick={() => setMode(index, { key: false })}
                  >
                    <ListIcon />
                  </Button>
                ) : null}
              </div>
            )}

            {choices && !typedValue ? (
              <ChoiceValue
                id={`${id}-value-${index}`}
                index={index}
                value={pair.value}
                choices={choices}
                groups={groups}
                onChange={(next) => replace(index, { ...pair, value: next })}
                onType={() => setMode(index, { value: true })}
              />
            ) : (
              <div className="flex min-w-0 flex-1 items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  <TemplateInput
                    id={`${id}-value-${index}`}
                    value={pair.value}
                    groups={groups}
                    placeholder="value or {{ template }}"
                    onChange={(next) => replace(index, { ...pair, value: next })}
                  />
                </div>
                {/* Only where there is a list to go back to: a column with fixed options whose
                    value is currently being typed. */}
                {choices ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Choose value ${index + 1} from the list`}
                    title="Choose from list"
                    onClick={() => setMode(index, { value: false })}
                  >
                    <ListIcon />
                  </Button>
                ) : null}
              </div>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove field ${index + 1}`}
              onClick={() => {
                onChange(value.filter((_, at) => at !== index));
                setModes((rows) => rows.filter((_, at) => at !== index));
              }}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          // Opening on the first column nothing has claimed yet: a new row exists to write a
          // column that is not written yet, and an empty key is a row the node would reject.
          onChange([...value, { key: firstUnusedKey(loaded, usedKeys), value: "" }]);
          setModes((rows) => [...rows, NO_MODE]);
        }}
        className="w-full"
      >
        <PlusIcon />
        {addLabel}
      </Button>

      {listing.state === "failed" ? (
        <p className="text-xs text-muted-foreground">{listing.error}</p>
      ) : null}
    </div>
  );
}
