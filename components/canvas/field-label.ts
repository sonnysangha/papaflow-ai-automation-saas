/**
 * The name a config field is *shown* under, as opposed to the name it is *addressed* by.
 *
 * Every control in the config panel is generated from a node's zod `inputs`, so the only name a
 * field starts with is the property name the engine uses — `connectionId`, `authHeader`,
 * `everyMinutes`. Those are the right names inside a template (`{{ http_1.body }}`) and the wrong
 * ones above a text box, so the panel shows the label this module derives and keeps the raw key in
 * the "Referenced in templates as" hint, where it is documentation rather than a question.
 *
 * A node overrides the derived label with `.meta({ label: "…" })` on the field, which survives
 * `z.toJSONSchema()` as an extra key — the same route `picker` already takes. Overriding is for the
 * handful of names no rule can rescue (`everyMinutes` → "Every (minutes)"); everything else reads
 * correctly from the two rules below.
 *
 * The same split applies twice more, and lives here for the same reason: `.meta({ options })` gives
 * an enum's *values* display words (`greaterThan` → "is greater than") while the graph keeps
 * storing the value, and `.meta({ showWhen })` lets a node hide a field that does not apply to the
 * mode you picked. All three keys survive `z.toJSONSchema()`, which is the whole trick.
 *
 * React-free so it can be unit tested on its own.
 */

/**
 * Names read out as letters rather than spoken as words, so they stay upper-case wherever they
 * appear. Deliberately short: a word wrongly listed here shouts at the user on every node.
 */
const ACRONYMS = new Set([
  "api",
  "css",
  "csv",
  "db",
  "html",
  "http",
  "https",
  "id",
  "ip",
  "json",
  "jwt",
  "pdf",
  "sms",
  "sql",
  "ttl",
  "ui",
  "uri",
  "url",
  "uuid",
  "xml",
]);

/** `connectionId` → `["connection", "Id"]`, `HTTPMethod` → `["HTTP", "Method"]`. */
function splitWords(name: string): string[] {
  return name
    .replace(/[_\-.\s]+/g, " ")
    // camelCase and digit→capital boundaries: `authHeader`, `sha256Digest`.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // …and the end of an acronym run that runs into a word: `HTTPMethod`, `jsonBody` is unaffected.
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter((word) => word.length > 0);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The label a property name earns on its own: sentence case, acronyms shouted, and a trailing
 * `Id` dropped.
 *
 * Dropping `Id` is the one rule that changes meaning rather than spelling, and it is right for the
 * same reason the field is a picker and not a text box: `connectionId` asks for a connection,
 * `chatId` asks for a chat. A name that is *only* `id` keeps it — there is nothing else left.
 */
export function humaniseFieldName(name: string): string {
  const words = splitWords(name.trim());
  if (words.length === 0) return "";

  const trimmed =
    words.length > 1 && words[words.length - 1].toLowerCase() === "id"
      ? words.slice(0, -1)
      : words;

  return trimmed
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return index === 0 ? capitalise(word) : lower;
    })
    .join(" ");
}

/** A field's schema, seen through the three `.meta()` keys this module reads. */
export type LabelledSchema =
  | { label?: unknown; options?: unknown; showWhen?: unknown }
  | null
  | undefined;

/**
 * The label to render above a field: the node's own `.meta({ label })` when it declared one,
 * otherwise the humanised property name.
 */
export function fieldLabel(name: string, schema?: LabelledSchema): string {
  const declared = schema?.label;
  if (typeof declared === "string" && declared.trim().length > 0) return declared.trim();
  return humaniseFieldName(name) || name;
}

/** One choice in a `z.enum()` field: the value the graph stores, and the words the reader sees. */
export type EnumOption = { value: string; label: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The words one `z.enum()` value is *shown* under, as opposed to the value that is stored.
 *
 * A node declares them with `.meta({ options: { equals: "is equal to", … } })`, which survives
 * `z.toJSONSchema()` beside `enum` the same way `label` and `picker` do — so the Condition node can
 * offer "is greater than" while the graph, the templates and `run()` keep seeing `greaterThan`.
 *
 * The fallback is the raw value, deliberately: most enums on a node are already the right words
 * (`GET`, `POST`, a model id), and humanising them would turn `GET` into "Get".
 */
export function optionLabel(value: string, schema?: LabelledSchema): string {
  const declared = record(schema?.options)?.[value];
  if (typeof declared === "string" && declared.trim().length > 0) return declared.trim();
  return value;
}

/** Every choice of an enum field, in the schema's own order, paired with its display words. */
export function enumOptions(values: readonly string[], schema?: LabelledSchema): EnumOption[] {
  return values.map((value) => ({ value, label: optionLabel(value, schema) }));
}

/**
 * Whether a field applies to the configuration in front of you.
 *
 * `.meta({ showWhen: { mode: "duration" } })` says "only ask this when `mode` is `duration`" — the
 * Wait node's two mutually exclusive fields, where showing both is the confusing part. Every entry
 * has to match, a value may be a list of acceptable ones, and a field with no `showWhen` is always
 * shown. `values` must be the *effective* inputs (the node's schema defaults filled in), or a node
 * nobody has touched yet would hide both halves of its own form.
 */
export function fieldVisible(schema: LabelledSchema, values: Record<string, unknown>): boolean {
  const when = record(schema?.showWhen);
  if (!when) return true;

  return Object.entries(when).every(([name, expected]) => {
    const actual = values[name];
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}
