// Pure logic behind the Run dialog's form-trigger test: a sensible sample per field, and how a set
// of typed answers becomes the exact payload shape `app/api/forms/[workflowId]/route.ts` builds
// from a real submission. Nothing here touches the DOM or `localStorage` — `FormRunDialog` owns
// both — so the coercion rules are unit-testable on their own.
//
// The "present, then coerce" rule mirrors `validate()`/`schemaFor()` in the forms route rather than
// importing them: a `route.ts` module is not something the rest of the app imports (it carries its
// own `runtime` export and is meant to be reached over HTTP), so the two are kept in lockstep by
// inspection — the same reason `graph-io.ts#derivedKey` gives for its own duplication.
import type { FormField, FormSpec } from "@/nodes/triggers/form";

/** One typed answer per field name — the same shape `PublicForm`'s own state holds. */
export type FormAnswers = Record<string, string>;

/** What a real submission's trigger payload looks like: `{ values, submittedAt }`. */
export type FormRunPayload = {
  values: Record<string, unknown>;
  submittedAt: number;
};

/** `""` (or whitespace-only) means "not filled in" — the same rule the route's `present()` uses. */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * A sensible default for one field, so the dialog opens with something runnable rather than a wall
 * of empty inputs. A select starts on its own first option — what a visitor leaves in place if they
 * never touch the control — and one with no options configured yet has nothing to sample.
 */
export function sampleValueFor(field: FormField): string {
  switch (field.type) {
    case "email":
      return "you@example.com";
    case "number":
      return "42";
    case "select":
      return field.options?.[0] ?? "";
    case "textarea":
      return `This is a sample ${field.label.toLowerCase()}.`;
    default:
      return `Sample ${field.label.toLowerCase()}`;
  }
}

/** A sample answer for every configured field, keyed by field name. */
export function sampleAnswers(fields: readonly FormField[]): FormAnswers {
  const answers: FormAnswers = {};
  for (const field of fields) answers[field.name] = sampleValueFor(field);
  return answers;
}

/**
 * Answers to open the dialog with: the last set remembered for this workflow, filled out with a
 * sample for any field the form has gained since. A saved answer for a field the form has since
 * lost is not carried forward — there is nowhere left on screen to show it.
 */
export function mergeAnswers(spec: FormSpec, stored: FormAnswers | null | undefined): FormAnswers {
  const samples = sampleAnswers(spec.fields);
  if (!stored) return samples;
  const merged: FormAnswers = {};
  for (const field of spec.fields) {
    const value = stored[field.name];
    merged[field.name] = value === undefined ? samples[field.name] : value;
  }
  return merged;
}

/** Required fields left blank — what the dialog disables "Run with these answers" on. */
export function missingRequiredFields(spec: FormSpec, answers: FormAnswers): string[] {
  return spec.fields
    .filter((field) => field.required && isBlank(answers[field.name]))
    .map((field) => field.name);
}

/**
 * The trigger payload a run started from here should carry — built the same way the forms route
 * builds one from a real submission: a blank field, required or not, is left out of `values` rather
 * than sent as `""`; a number field's typed string becomes an actual number (`z.coerce.number()`
 * there, `Number()` here — the same coercion `z.coerce.number()` performs internally); a select's
 * value passes through as-is, since the dialog's own `<Select>` already restricts it to one of the
 * field's configured options, leaving nothing left to validate.
 *
 * `now` defaults to `Date.now()` but takes a value so a test can assert the whole object.
 */
export function answersToPayload(
  spec: FormSpec,
  answers: FormAnswers,
  now: number = Date.now(),
): FormRunPayload {
  const values: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const raw = answers[field.name];
    if (isBlank(raw)) continue;
    values[field.name] = field.type === "number" ? Number(raw) : raw;
  }
  return { values, submittedAt: now };
}
