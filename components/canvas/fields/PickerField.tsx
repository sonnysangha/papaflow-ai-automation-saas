"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PencilIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  clearsOnConnectionChange,
  emptyListHint,
  pickerOptions,
  type PickerOption,
} from "../picker-options";
import type { VariableGroup } from "../VariablePicker";
import { TemplateInput } from "./TemplateInput";

/**
 * A dropdown over a list only the provider knows: Slack channels, Discord guilds and channels,
 * Telegram chats.
 *
 * A node input asks for one by declaring `z.string().meta({ picker: "channels" })`, which survives
 * into the JSON Schema the config panel generates. The list itself comes from
 * `POST /api/connections/:id/pick`, which opens the sealed credential server-side and answers with
 * ids and labels — no token ever reaches the browser (CLAUDE.md rule 1).
 *
 * Every provider list is incomplete in some way (a Slack bot only sees channels it is in, a Telegram
 * bot only knows chats that have written to it), so "Type a value" is always one click away and a
 * value that is a `{{ template }}` opens straight into it. The `models` kind is answered from the
 * connection's own stored list rather than a provider call, but it arrives here identically.
 */

export type { PickerOption };

export type PickerFieldProps = {
  id: string;
  /** The `picker: "<kind>"` from the node's schema — passed to the route verbatim. */
  kind: string;
  /** The node's chosen connection. The panel renders a plain text field when there isn't one. */
  connectionId: string;
  value: string;
  groups: VariableGroup[];
  /** Set while the kind is not answerable yet — a `tables:{baseId}` whose `baseId` is empty. */
  disabled?: boolean;
  /** Why it is disabled, in the user's terms: "Choose baseId first". */
  hint?: string;
  onChange: (value: string) => void;
};

type Listing =
  | { state: "loading" }
  | { state: "ready"; options: PickerOption[] }
  | { state: "failed"; error: string };

function isTemplate(value: string): boolean {
  return value.includes("{{");
}

async function fetchOptions(
  connectionId: string,
  kind: string,
  signal: AbortSignal,
): Promise<PickerOption[]> {
  const response = await fetch(`/api/connections/${connectionId}/pick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
    signal,
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (body as { error?: unknown }).error;
    throw new Error(typeof error === "string" ? error : "Could not load the list.");
  }

  const options = (body as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, label } = entry as { id?: unknown; label?: unknown };
    if (typeof id !== "string" || id.length === 0) return [];
    return [{ id, label: typeof label === "string" && label ? label : id }];
  });
}

export function PickerField({
  id,
  kind,
  connectionId,
  value,
  groups,
  disabled,
  hint,
  onChange,
}: PickerFieldProps) {
  // What is being listed right now. Held alongside the answer rather than reset in the effect: a
  // changed key *is* the loading state, so switching connections never renders a stale list and
  // the effect never has to call setState synchronously.
  const [reloads, setReloads] = useState(0);
  const listingKey = `${connectionId}\u0000${kind}\u0000${reloads}`;
  const [answer, setAnswer] = useState<{ key: string; listing: Listing } | null>(null);
  // `null` means "follow the value": a template is typed, anything else is chosen from the list.
  const [typing, setTyping] = useState<boolean | null>(null);

  useEffect(() => {
    // Nothing to ask for while a sibling input is still empty: the kind would name half a list.
    if (disabled) return;

    const controller = new AbortController();

    fetchOptions(connectionId, kind, controller.signal).then(
      (options) => {
        if (!controller.signal.aborted) {
          setAnswer({ key: listingKey, listing: { state: "ready", options } });
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setAnswer({
          key: listingKey,
          listing: {
            state: "failed",
            error: error instanceof Error ? error.message : "Could not load the list.",
          },
        });
      },
    );

    return () => controller.abort();
  }, [connectionId, disabled, kind, listingKey]);

  const listing: Listing = answer?.key === listingKey ? answer.listing : { state: "loading" };
  const reload = useCallback(() => setReloads((count) => count + 1), []);

  // What this connection actually offers, or `null` while that is still unknown (loading, failed).
  const loaded = listing.state === "ready" ? listing.options : null;

  // The connection the value in hand was chosen against. Choosing a different one drops a value the
  // new account does not offer — under an Anthropic key, `gpt-5` is the old account's answer rather
  // than a custom id somebody meant, and the run would fail on it. Only the model list is complete
  // enough to argue that (see `clearsOnConnectionChange`), so every other kind keeps its value. The
  // ref only moves once a list has arrived, so the first load of an existing node never clears
  // anything.
  const listedFor = useRef(connectionId);
  useEffect(() => {
    if (loaded === null || listedFor.current === connectionId) return;
    listedFor.current = connectionId;
    if (clearsOnConnectionChange(kind, loaded, value)) onChange("");
  }, [connectionId, kind, loaded, onChange, value]);

  // Waiting on another field. Shown as the dropdown it is about to become, rather than as a text
  // box, so the panel does not reflow the moment the sibling is filled in — and carrying the
  // reason inside the control itself, because an empty disabled select reads as broken.
  if (disabled) {
    const waiting = hint ?? "Not ready yet";
    return (
      <div className="space-y-1">
        <div
          id={id}
          role="button"
          aria-disabled
          aria-label={waiting}
          className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"
        >
          <span className="truncate">{waiting}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          The list depends on that answer, so there is nothing to offer yet.
        </p>
      </div>
    );
  }

  const manual = typing ?? isTemplate(value);
  // An empty list a reload cannot fix — a connection stored before its model list was captured —
  // is not a dropdown at all, so the field becomes a text box with the way out written under it.
  const empty = loaded !== null && loaded.length === 0 ? emptyListHint(kind) : null;
  // A list that cannot be loaded is not a reason to block editing: the field falls back to text.
  if (manual || listing.state === "failed" || empty !== null) {
    return (
      <div className="space-y-1">
        <TemplateInput id={id} value={value} groups={groups} onChange={onChange} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {listing.state === "failed"
              ? listing.error
              : (empty ?? `Typing a ${kind.split(":")[0]} value.`)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTyping(false);
              // Both of these are answers that can change without this field knowing: a provider
              // that was down, or a connection just re-tested on the Connections page.
              if (listing.state === "failed" || empty !== null) reload();
            }}
          >
            <RefreshCwIcon />
            Choose from list
          </Button>
        </div>
      </div>
    );
  }

  // A value the list does not contain (a channel that was renamed, a model id typed before this
  // field was a dropdown) is kept as its own `Custom: …` option, so choosing something else stays
  // a deliberate act rather than something the panel does behind the user's back. `loaded` stays
  // `null` while the list is in flight, which is what keeps the trigger from calling a saved value
  // custom before there is anything to have compared it against.
  const options = pickerOptions(loaded, value);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Select
          value={value || null}
          disabled={listing.state === "loading"}
          onValueChange={(next) => {
            if (typeof next === "string") onChange(next);
          }}
        >
          <SelectTrigger id={id} className="min-w-0 flex-1">
            {/* Base UI shows the raw value unless told otherwise; the function child maps it back
                to a label and owns the empty and loading cases. */}
            <SelectValue>
              {(current: unknown) => {
                if (typeof current !== "string" || current.length === 0) {
                  return listing.state === "loading"
                    ? "Loading…"
                    : options.length === 0
                      ? "Nothing to choose yet"
                      : "Choose…";
                }
                return options.find((option) => option.id === current)?.label ?? current;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Reload list"
          title="Reload list"
          disabled={listing.state === "loading"}
          onClick={reload}
        >
          <RefreshCwIcon />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Type a value"
          title="Type a value"
          onClick={() => setTyping(true)}
        >
          <PencilIcon />
        </Button>
      </div>

      {listing.state === "ready" && options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Nothing came back. Invite the bot where it needs to post, then reload — or type the value.
        </p>
      )}
    </div>
  );
}
