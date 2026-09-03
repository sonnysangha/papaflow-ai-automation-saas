// The Condition node's last comparison, read back as a sentence.
//
// A branch you cannot see is the hardest thing to debug on a canvas: the run went one way, the
// other half greyed out, and the panel shows you the template you wrote rather than the values it
// resolved to. The step row holds both — the resolved `input` (already redacted by the engine) and
// the `output`, which carries the two sides the comparison actually used — so this turns the pair
// back into the sentence the form is asking you to write: "score is greater than 10 → yes".
//
// Pure and React-free: it takes the same `LastRunStep` the panel already has and returns parts, not
// markup, so the panel can style the values differently from the words around them.
import { OPERATOR_LABELS, UNARY_OPERATORS } from "@/nodes/logic/condition";

import { previewOf, type LastRunStep } from "./last-run";

export type ConditionPreview = {
  /** The left-hand value as it was compared, one line. */
  left: string;
  /** The comparison as a sentence: "is greater than". */
  operator: string;
  /** The right-hand value, or null for a comparison that ignores it ("is empty"). */
  right: string | null;
  /** Which way the run went. */
  result: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What the Condition decided last time, or null when there is nothing honest to say — the node has
 * never run, the run is still going, or the row belongs to a failed attempt that produced no
 * result. A half-written sentence would be worse than no sentence.
 */
export function conditionPreview(run: LastRunStep | null): ConditionPreview | null {
  const output = run?.output;
  if (!isRecord(output) || typeof output.result !== "boolean") return null;

  const input = isRecord(run?.input) ? run.input : {};
  // The operator is configuration, so it only exists on the input; `equals` is the node's own
  // default and therefore what an unset field ran with.
  const operator = typeof input.operator === "string" ? input.operator : "equals";
  const label = OPERATOR_LABELS[operator as keyof typeof OPERATOR_LABELS] ?? operator;
  const unary = (UNARY_OPERATORS as readonly string[]).includes(operator);

  // `output.left`/`right` are what `run()` compared, which is the resolved template rather than the
  // `{{ … }}` still sitting in the form. The input is the fallback for an older row. `?? ""` is
  // what makes a missing side read as `""` instead of vanishing from the sentence.
  return {
    left: previewOf(output.left ?? input.left ?? ""),
    operator: label,
    right: unary ? null : previewOf(output.right ?? input.right ?? ""),
    result: output.result,
  };
}
