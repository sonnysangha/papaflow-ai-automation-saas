/**
 * Picker kinds that depend on a sibling input.
 *
 * Most remote lists stand on their own — `picker: "channels"` is everything Slack needs to know.
 * Some only exist relative to another choice: Airtable's tables live inside one base, which the
 * node declares as `picker: "tables:{baseId}"`. The placeholder names another input of the *same*
 * node, and the config panel fills it in from what the user has already configured before asking
 * the connector for the list.
 *
 * Pure and React-free on purpose: this is the one piece of the picker worth unit testing, and the
 * panel's job is only to disable the field while `missing` is not empty.
 */

/** `{name}` — a sibling input's value, not a `{{ template }}` (those are resolved at run time). */
const PLACEHOLDER = /\{([^{}]*)\}/g;

export type ResolvedPickerKind = {
  /** The kind to send to `/api/connections/:id/pick`, with every placeholder substituted. */
  kind: string;
  /** The sibling inputs that have no value yet, in the order they appear, without repeats. */
  missing: string[];
};

/** Whether a sibling input has been filled in at all. `0` and `false` count as answers. */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim().length === 0;
}

export function resolvePickerKind(
  kind: string,
  inputs: Record<string, unknown>,
): ResolvedPickerKind {
  const missing: string[] = [];

  const resolved = kind.replace(PLACEHOLDER, (_match, raw: string) => {
    const name = raw.trim();
    const value = inputs[name];
    if (isEmpty(value)) {
      if (!missing.includes(name)) missing.push(name);
      return "";
    }
    return String(value);
  });

  return { kind: resolved, missing };
}

/**
 * What a control waiting on a sibling says instead of a list: "Choose baseId and tableId first".
 *
 * The property name rather than the field's label, because that is what the panel puts on the
 * field it is pointing at (labels are derived from it, and a node may override one). Shared by the
 * single picker field and the key column of a key/value list so both name the wait the same way.
 */
export function missingHint(missing: readonly string[]): string | undefined {
  return missing.length === 0 ? undefined : `Choose ${missing.join(" and ")} first`;
}
