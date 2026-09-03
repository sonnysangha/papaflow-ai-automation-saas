/**
 * The two decisions a picker makes about a list once it has one: what to offer when the value the
 * node is configured with is not in it, and what to say when the list came back empty.
 *
 * React-free on purpose, like `picker-kind.ts` — these are the parts of the dropdown worth unit
 * testing, and the field itself is then only wiring.
 */
import { MODELS_PICKER } from "@/connectors/define";

export type PickerOption = { id: string; label: string };

/** How a value the connection did not offer is labelled, so the difference is visible. */
export const CUSTOM_PREFIX = "Custom: ";

/**
 * The options to render, given what the connection listed and what the node currently holds.
 *
 * A configured value the list does not contain is kept as an option of its own rather than dropped:
 * it may be a model id typed before the field became a dropdown, a channel that was renamed, or an
 * id pasted from elsewhere. A config panel that silently forgets what a saved workflow says is
 * worse than one offering a value the provider might refuse — but it is labelled, so nobody reads
 * it as something the account actually offers.
 */
export function pickerOptions(loaded: readonly PickerOption[], value: string): PickerOption[] {
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
 * Whether choosing a different connection should clear the value this field holds.
 *
 * Switching accounts is the one moment a value the list does not contain stops being worth keeping:
 * `gpt-5` under an Anthropic key is not a custom id somebody meant, it is the previous account's
 * answer, and the run would fail on it. An empty list proves nothing (the new connection may simply
 * have no captured list), and a `{{ template }}` is always deliberate, so both are left alone.
 */
export function clearsOnConnectionChange(
  loaded: readonly PickerOption[],
  value: string,
): boolean {
  if (value.length === 0 || value.includes("{{")) return false;
  if (loaded.length === 0) return false;
  return !loaded.some((option) => option.id === value);
}
