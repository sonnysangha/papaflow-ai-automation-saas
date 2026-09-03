/**
 * The three decisions a picker makes about a list: what to offer while it is still arriving, what
 * to offer when the value the node is configured with is not in it, and what to say when it came
 * back empty.
 *
 * React-free on purpose, like `picker-kind.ts` — these are the parts of the dropdown worth unit
 * testing, and the field itself is then only wiring.
 */
import { MODELS_PICKER } from "@/connectors/define";
import { CONNECTORS } from "@/connectors/registry";

/**
 * One remote object a field can be filled from, exactly as `connectors/define.ts` describes it —
 * repeated here rather than imported so the browser half of the picker owns its own wire shape.
 *
 * `type` and `choices` only arrive for lists whose answer shapes a *second* field: an Airtable
 * column's `singleSelect` and its options, a Notion `status` and its names. Everything that reaches
 * here came from `/api/connections/:id/pick`, which returns the connector's array untouched, so
 * these are descriptions of remote objects and never any part of a credential (CLAUDE.md rule 1).
 */
export type PickerOption = {
  id: string;
  label: string;
  /** The provider's own type for this object — `singleSelect`, `multi_select`, `rich_text`. */
  type?: string;
  /** The values an enum-like object accepts, by name, in the order the provider lists them. */
  choices?: string[];
};

/** How a value the connection did not offer is labelled, so the difference is visible. */
export const CUSTOM_PREFIX = "Custom: ";

/**
 * `{ options: … }` from the pick route, narrowed to the options that are usable.
 *
 * Anything without a string `id` is dropped — a list is only as good as the value it writes into
 * the node — and `label` falls back to the id, because a dropdown row with no words is not a
 * choice. `type` and `choices` are carried through when they are the right shape and simply left
 * off when they are not: they are decoration on the key column and the source of the value
 * dropdown, and a connector that omits them is the normal case, not an error.
 */
export function parsePickerOptions(body: unknown): PickerOption[] {
  const options = (body as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return [];

  return options.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, label, type, choices } = entry as {
      id?: unknown;
      label?: unknown;
      type?: unknown;
      choices?: unknown;
    };
    if (typeof id !== "string" || id.length === 0) return [];

    const option: PickerOption = {
      id,
      label: typeof label === "string" && label ? label : id,
    };
    if (typeof type === "string" && type.length > 0) option.type = type;
    if (Array.isArray(choices)) {
      const named = choices.filter((choice): choice is string => typeof choice === "string");
      if (named.length > 0) option.choices = named;
    }
    return [option];
  });
}

/**
 * The options to render, given what the connection listed and what the node currently holds.
 *
 * `loaded` is `null` until an answer arrives, and that distinction is the whole point of the first
 * branch: "the list does not contain this" and "there is no list yet" look identical if you flatten
 * them to `[]`, and flattening makes the trigger announce `Custom: gpt-5` for a perfectly standard
 * model for as long as the round-trip takes. Until the list is known the value is shown as itself.
 *
 * Once it *is* known, a configured value the list does not contain is kept as an option of its own
 * rather than dropped: it may be a model id typed before the field became a dropdown, a channel
 * that was renamed, or an id pasted from elsewhere. A config panel that silently forgets what a
 * saved workflow says is worse than one offering a value the provider might refuse — but it is
 * labelled, so nobody reads it as something the account actually offers.
 */
export function pickerOptions(
  loaded: readonly PickerOption[] | null,
  value: string,
): PickerOption[] {
  if (loaded === null) return value.length === 0 ? [] : [{ id: value, label: value }];
  if (value.length === 0 || loaded.some((option) => option.id === value)) return [...loaded];
  return [...loaded, { id: value, label: `${CUSTOM_PREFIX}${value}` }];
}

/**
 * What a field says *instead of* an empty dropdown, or `null` to keep the dropdown.
 *
 * Only the model list has one. An empty channel list is a state the user can fix from the provider
 * ("invite the bot"), so the field stays a dropdown with a note under it; an empty model list means
 * this connection was stored before its list was captured, and there is nothing to choose from at
 * all — so the field becomes the text box it used to be, with the way out written on it.
 */
export function emptyListHint(kind: string): string | null {
  return kind === MODELS_PICKER
    ? "This connection has no model list — re-test it on the Connections page or type a model id"
    : null;
}

/**
 * The sentence under a dropdown that stayed a dropdown and came back empty, for a connection whose
 * provider we do not know (the list is still loading, or the row has since been deleted).
 *
 * Deliberately vague, because it has to be true of every provider at once — which is exactly why
 * the provider-specific version below exists.
 */
export const GENERIC_EMPTY_NOTE =
  "Nothing came back. Invite the bot where it needs to post, then reload — or type the value.";

/**
 * …and the same sentence in one provider's own terms, when the connector has written one.
 *
 * "Invite the bot where it needs to post" is actively wrong for Telegram — a bot cannot be invited
 * into a DM, and cannot message anybody who has not written to it first — so a Telegram user
 * following it goes looking for an invite that does not exist. `ConnectorDef.emptyHint` is where
 * each provider says what actually fills its list; this is only the lookup, so the wording stays
 * next to the `pick()` that produced the empty list.
 */
export function emptyOptionsNote(kind: string, provider: string | undefined): string {
  const hint = provider ? CONNECTORS[provider]?.emptyHint?.(kind) : null;
  return hint ?? GENERIC_EMPTY_NOTE;
}

/**
 * Whether choosing a different connection should clear the value this field holds.
 *
 * Only for the model list, and only because that list is complete: a provider's catalogue is every
 * model the key may call, so `gpt-5` under an Anthropic key is not a custom id somebody meant, it
 * is the previous account's answer and the run would fail on it.
 *
 * No other kind may be treated that way, because no other list here is complete. A Telegram bot
 * only knows the chats that have written to it, a Slack bot only the channels it is in — and
 * `connectors/slack.ts` stops paginating after `MAX_PAGES` regardless — so "absent from the list"
 * is not evidence that the account lacks it, and deleting a hand-typed chat id on a connection
 * swap would be silent data loss. An empty list proves nothing either (the new connection may
 * simply have no captured list), and a `{{ template }}` is always deliberate.
 */
export function clearsOnConnectionChange(
  kind: string,
  loaded: readonly PickerOption[],
  value: string,
): boolean {
  if (kind !== MODELS_PICKER) return false;
  if (value.length === 0 || value.includes("{{")) return false;
  if (loaded.length === 0) return false;
  return !loaded.some((option) => option.id === value);
}

/**
 * The same three decisions, for the key half of a `{ key, value }` row (`keyPicker` on the array):
 * an Airtable column, a Notion property. Two things differ from `pickerOptions`.
 *
 * A key is a *slot*: writing the same column twice in one record is not a thing anyone means, and
 * the second row silently wins, so a key another row already holds is not offered here at all.
 * `used` is every row's key including this one's, and this row's own key is what it is exempted by
 * — otherwise the control would immediately drop the value it is displaying, and two rows that
 * somehow already share a key would both blank themselves.
 *
 * The rest is `pickerOptions`: `null` is "no list yet" rather than "the list lacks this", and a key
 * the list does not contain is kept as `Custom: …` so a workflow saved against a column that has
 * since been renamed still says what it was configured to write.
 */
export function keyOptions(
  loaded: readonly PickerOption[] | null,
  used: readonly string[],
  current: string,
): PickerOption[] {
  if (loaded === null) return current.length === 0 ? [] : [{ id: current, label: current }];

  const taken = new Set(used.filter((key) => key !== current));
  const offered = loaded.filter((option) => !taken.has(option.id));
  if (current.length === 0 || offered.some((option) => option.id === current)) return offered;
  return [...offered, { id: current, label: `${CUSTOM_PREFIX}${current}` }];
}

/**
 * What "Add field" should start the new row on: the first column nothing has claimed yet.
 *
 * Adding a row to write a column you have already written is never the intent, and an empty key is
 * a row the node would reject — so the button spends the list rather than opening a blank slot.
 * `""` when there is no list yet, or when every column is taken; the row is then typed into as
 * before.
 */
export function firstUnusedKey(
  loaded: readonly PickerOption[] | null,
  used: readonly string[],
): string {
  if (loaded === null) return "";
  const taken = new Set(used);
  return loaded.find((option) => !taken.has(option.id))?.id ?? "";
}

/**
 * The values this key's column accepts, or `null` if it accepts prose.
 *
 * Only an enum-like column has them (`singleSelect`, `status`, `multi_select`), and only then does
 * the value half stop being a free text field. `null` — rather than `[]` — for every other case, so
 * "this column has no fixed options" and "we have not asked yet" both leave the text field alone.
 */
export function choicesForKey(
  loaded: readonly PickerOption[] | null,
  key: string,
): string[] | null {
  if (loaded === null || key.length === 0) return null;
  const choices = loaded.find((option) => option.id === key)?.choices;
  return choices && choices.length > 0 ? [...choices] : null;
}
