"use client";

import { useCallback, useEffect, useState } from "react";

import { parsePickerOptions, type PickerOption } from "../picker-options";

/**
 * One list read through `POST /api/connections/:id/pick` — Slack's channels, an Airtable table's
 * columns, a Notion data source's properties.
 *
 * A hook rather than a helper inside `PickerField` because two very different controls need the
 * same list on the same terms. A `PickerField` is one field asking for one list; a `KeyValueList`
 * is *n* rows whose key dropdowns are all the same list, and a fetch per row would be a request per
 * row — so the list is read once, where the rows are, and handed down. Both get the same three
 * states, the same "no answer yet is not an empty answer" distinction, and the same reload.
 *
 * No credential is involved on this side: the browser names the list it wants and the route opens
 * the sealed secret server-side (CLAUDE.md rule 1).
 */

export type PickListing =
  | { state: "loading" }
  | { state: "ready"; options: PickerOption[] }
  | { state: "failed"; error: string };

export type ConnectionPick = {
  listing: PickListing;
  /** What the connection listed, or `null` while that is unknown — loading, failed, or waiting. */
  loaded: PickerOption[] | null;
  /** Ask again: a provider that was down, a column added since the panel was opened. */
  reload: () => void;
};

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

  return parsePickerOptions(body);
}

/**
 * `disabled` is for a kind that is not answerable yet — a `fields:{baseId}:{tableId}` whose table
 * is still unchosen would name half a list. Nothing is requested, and `loaded` stays `null`.
 */
export function useConnectionPick(
  connectionId: string,
  kind: string,
  disabled = false,
): ConnectionPick {
  // What is being listed right now. Held alongside the answer rather than reset in the effect: a
  // changed key *is* the loading state, so switching connections never renders a stale list and
  // the effect never has to call setState synchronously.
  const [reloads, setReloads] = useState(0);
  const listingKey = `${connectionId}\u0000${kind}\u0000${reloads}`;
  const [answer, setAnswer] = useState<{ key: string; listing: PickListing } | null>(null);

  useEffect(() => {
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

  const listing: PickListing = answer?.key === listingKey ? answer.listing : { state: "loading" };
  const reload = useCallback(() => setReloads((count) => count + 1), []);

  return {
    listing,
    // `null` rather than `[]` while the answer is unknown: every caller has to tell "the list does
    // not contain this" apart from "there is no list yet" to decide what is custom.
    loaded: listing.state === "ready" ? listing.options : null,
    reload,
  };
}
