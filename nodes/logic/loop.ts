import { z } from "zod";
import { ConnectorError, defineNode } from "../define";

/** The node type the orchestrator recognises. Stable: stored graphs carry it. */
export const LOOP_TYPE = "logic.loop";
/** The handle the body hangs off — every node on this chain runs once per item. */
export const EACH_HANDLE = "each";
/** …and the one the run continues down when the items are exhausted. */
export const DONE_HANDLE = "done";

/**
 * The configured `items`, as a string.
 *
 * The field is a template, so the natural thing for a user to type is `{{ http_request_1.body }}`
 * — and `resolveTemplates` gives a whole-template reference back as the raw value it points at,
 * which is an array, not a string. `z.string()` would reject it before `run` ever saw it, so the
 * array is serialised here and parsed back by `loopItems`. The upshot is a plain text field in the
 * config panel (JSON Schema `{ type: "string" }`, with the variable picker beside it) that still
 * accepts a real array at run time.
 *
 * A missing value becomes `"null"` rather than a zod "required" error, so an unconfigured Loop
 * fails with the sentence below instead of a schema dump.
 */
const items = z
  .preprocess(
    (value) => (typeof value === "string" ? value : JSON.stringify(value ?? null)),
    z.string(),
  )
  .describe(
    "Point at a list, e.g. {{ http_request_1.body.items }} — the nodes wired to “each item” run " +
      "once per entry, then “when done” continues.",
  )
  .meta({ label: "List to loop over" });

/**
 * Whatever the template resolved to → the list to iterate.
 *
 * An array is taken as it is; a string is parsed, because a template embedded in other text is
 * stringified and because plenty of APIs return JSON as a string. Anything else is a configuration
 * mistake, and a 400 means `runNode` turns it into a `FatalError`: retrying "the number 7 is not a
 * list" three times helps nobody (CLAUDE.md rule 7).
 */
export function loopItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to the same message: unparseable text is no more a list than a number is.
    }
  }

  throw new ConnectorError(
    "Loop: items must resolve to an array. Point it at a list, e.g. {{ http_request_1.body }}.",
    400,
  );
}

/**
 * Run the chain wired to `each` once per item, then carry on from `done`.
 *
 * The node itself barely does anything: it normalises the list and reports how long it is. The
 * iteration lives in `runGraph`, which is the only place that may drive a step in a loop — a node's
 * `run` is one step, and one step cannot contain others. `expand` is the hand-off: `runNode`
 * returns the normalised items alongside the output, and the orchestrator runs the body once per
 * item with `{{ $item }}` bound to it, collecting the last body node's output into `results`.
 *
 * v1 is deliberately narrow: one chain after `each` (a branch inside the body is not followed), no
 * nesting (a Loop inside a body runs as an ordinary node and its own body is skipped), and one item
 * at a time. Nodes on the body chain see `{{ $item }}` and each other's output *for the current
 * iteration only*; everything downstream of `done` reads `{{ <loop key>.results }}` instead.
 */
export const loopNode = defineNode({
  type: LOOP_TYPE,
  name: "For each item",
  description: "Run the same steps once for every item in a list.",
  category: "logic",
  guide: {
    summary:
      "Take a list and work through it one entry at a time. The nodes wired to “each item” run " +
      "once per entry and read the current one as {{ $item }}; when the list runs out the run " +
      "carries on from “when done”, where {{ <this node's key>.results }} holds every answer.",
    outputs: { [EACH_HANDLE]: "each item", [DONE_HANDLE]: "when done" },
  },
  icon: "Repeat",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({ items }),
  outputs: z.object({
    /** The last body node's output, one entry per item. Filled in by `runGraph`, not by `run`. */
    results: z.array(z.any()),
    /** How many items the template resolved to. */
    count: z.number(),
  }),
  handles: () => [EACH_HANDLE, DONE_HANDLE],
  expand: (inputs) => loopItems(inputs.items),
  async run({ inputs }) {
    // `results` is empty here on purpose: the iterations have not happened yet. `runGraph` records
    // the real output on this step once they have.
    return { results: [], count: loopItems(inputs.items).length };
  },
});
