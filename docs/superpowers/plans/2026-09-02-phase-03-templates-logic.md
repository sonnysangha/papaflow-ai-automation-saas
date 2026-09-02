# Phase 3 — Templates, Variable Picker, Logic Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development — one fresh Opus subagent per task. Tests first.

**Goal:** `{{ key.path }}` templates resolved before `inputs.parse()`, a variable picker built from upstream output schemas, a generated config panel, and Set / Condition / Switch nodes with real branch handles; untaken branches grey out after a run.

**Architecture:** Every canvas node gets a stable human `key` (`http_request_1`) used in templates; run outputs are keyed by that key (`outputs[key]`), edges still use ids. `nodes/templates.ts` is a pure resolver (unit-tested) that `runNode` applies to `node.data.inputs` before zod parsing. The config panel is generated from each node's zod `inputs` JSON schema; the picker lists paths from upstream nodes' zod `outputs`.

**Spec:** master plan Phase 3, CLAUDE.md "Node definition" (`Templates are {{ nodeId.field }} resolved by resolveTemplates() before inputs.parse()`), `docs/PLAN.md` 367-372 (Logic and control) and 407.

## Global constraints

- No `eval`/`new Function`. Templates are path lookups only.
- Resolver contract: `resolveTemplates(value, ctx) → { value, warnings: string[] }` where `ctx = { [nodeKey]: output, trigger: triggerPayload, $item?: unknown }`. A string that is exactly one template (`/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/`) resolves to the raw value (object/number/boolean preserved); templates embedded in longer strings stringify (`JSON.stringify` for objects, `String()` otherwise). Missing paths resolve to `""` and add a warning `"{{ a.b }}: not found"`. Paths: dot segments and `[n]` indices; `$item` and `trigger` are reserved roots.
- Node keys: `^[a-z][a-z0-9_]*$`, unique per workflow; generated on drop as `<type with '.' → '_'>_<n>`; editable in the panel (rename rewrites `{{ oldKey.` → `{{ newKey.` in every node's inputs). Existing nodes without a key get one on load (`migrateKeys` in `graph-io.ts`).
- Condition/Switch never throw on odd inputs: comparisons coerce numbers when both sides parse as numbers, otherwise compare strings; regex errors → `false`.

## File structure

```
nodes/templates.ts                          resolveTemplates, extractRefs, renameKeyInTemplates
nodes/logic/condition.ts  nodes/logic/switch.ts  nodes/logic/set.ts
nodes/registry.ts (mod)                     register the three
nodes/paths.ts                              outputPaths(zodSchema) → [{ path, type }] (from JSON schema, depth ≤ 3, arrays as [0])
workflows/types.ts (mod)                    RunNode.data.key; NodeInput.trigger
workflows/graph.ts (mod)                    toRunGraph sets keys; upstreamKeys(graph, nodeId)
workflows/run-graph.ts (mod)                outputs keyed by key; pass trigger
workflows/steps/run-node.ts (mod)           resolveTemplates → inputs.parse; store warnings on the step row (`steps.warnings` optional field → schema mod)
convex/schema.ts (mod)                      steps.warnings: v.optional(v.array(v.string()))
components/canvas/ConfigPanel.tsx           right panel for the selected node (generated form)
components/canvas/fields/*.tsx              TemplateInput, KeyValueList, TagList, JsonField, EnumSelect, BooleanSwitch
components/canvas/VariablePicker.tsx        popover: upstream nodes → paths → insert {{ key.path }}
components/canvas/graph-io.ts (mod)         key generation + migrateKeys
components/canvas/Canvas.tsx (mod)          selection → panel; edge styling from step handles; skipped ring
components/canvas/WorkflowNode.tsx (mod)    show key under label; dynamic handles with labels
tests/templates.test.ts  tests/logic.test.ts  tests/paths.test.ts
```

### Task 1: Template resolver + paths helper (+ tests)

- [ ] Tests first (`tests/templates.test.ts`): full-template raw value (`"{{ http_request_1.body }}"` → the object); embedded stringification; nested `[0]` paths; missing → `""` + warning; `$item` and `trigger` roots; `extractRefs("{{ a.b }} and {{ c }}") → ["a.b","c"]`; `renameKeyInTemplates` rewrites only the matching root. `tests/paths.test.ts`: `outputPaths(z.object({ status: z.number(), body: z.any(), headers: z.record(z.string(), z.string()) }))` → contains `status` (number), `body` (any), `headers` (object). Implement `nodes/templates.ts`, `nodes/paths.ts` (uses `z.toJSONSchema`; `any` → type "any"; objects recurse to depth 3; arrays add `[0]`). Commit `feat(templates): resolver, refs, output paths`.

### Task 2: Logic nodes (+ tests) and engine wiring

- [ ] `nodes/logic/condition.ts` (`logic.condition`, icon `GitBranch`): inputs `{ left: z.string().default(""), operator: z.enum(["equals","notEquals","contains","notContains","greaterThan","lessThan","isEmpty","isNotEmpty","matchesRegex"]).default("equals"), right: z.string().default("") }`, outputs `{ result: z.boolean(), left: z.any(), right: z.any() }`, `handles: () => ["true","false"]`, `handle: (o) => (o.result ? "true" : "false")`.
- [ ] `nodes/logic/switch.ts` (`logic.switch`, icon `Split`): inputs `{ value: z.string().default(""), cases: z.array(z.string().min(1)).default([]) }`, outputs `{ matched: z.string(), value: z.any() }`, `handles: (i) => [...i.cases, "default"]`, `handle: (o) => o.matched`; run: exact match (trimmed, case-sensitive) else `"default"`.
- [ ] `nodes/logic/set.ts` (`logic.set`, icon `Braces`): inputs `{ fields: z.array(z.object({ key: z.string().min(1), value: z.string() })).default([]) }`, outputs `z.record(z.string(), z.any())`; run builds the object (values already template-resolved; a value that is exactly a template keeps its raw type).
- [ ] Tests (`tests/logic.test.ts`): every operator incl. numeric coercion (`"10" greaterThan "9"` true), regex error → false, switch default, set output. Register the three in `nodes/registry.ts`.
- [ ] Engine: `workflows/types.ts` adds `data.key` and `NodeInput.trigger`; `workflows/graph.ts#toRunGraph` fills keys (fallback `n_<index>`); `run-graph.ts` keeps `outputs` keyed by `key` (`outputs[graph.nodes[triggerId].data.key] = trigger.payload`, and passes `trigger`); `run-node.ts`: `const { value, warnings } = resolveTemplates(node.data.inputs, { ...outputs, trigger, $item: item })` → `def.inputs.parse(value)`; write `warnings` on the step row (add `warnings: v.optional(v.array(v.string()))` to `steps` in `convex/schema.ts` and the `markStep` validator; push). Tests updated. Commit `feat(logic): condition, switch, set nodes; templates in runNode`.

### Task 3: Config panel, variable picker, keys, branch styling

- [ ] `graph-io.ts`: `nextKey(nodes, nodeType)`; `migrateKeys(nodes)`; drop handler assigns keys. `WorkflowNode` shows `key` in muted mono under the label; source handles from `def.handles(inputs)` with labels when >1.
- [ ] `ConfigPanel.tsx` (`<Sheet side="right">` or a fixed right column, 360 px): header (icon, name, description), fields `label` and `key` (validated, rename rewrites templates), then the generated form from `NODES[nodeType].inputs` JSON schema: `string` → `TemplateInput` (Input, or Textarea when `format`/`description` hints multi-line or name is `body|text|prompt`), `number` → Input type number, `boolean` → Switch, `enum` → Select, `array of string` → TagList, `array of {key,value}` → KeyValueList, `object/record` → JsonField (Textarea + JSON validation). Each `TemplateInput` has a `{}` button opening `VariablePicker`.
- [ ] `VariablePicker.tsx`: `upstreamKeys(graph, nodeId)` (ancestors via reverse edges) → for each upstream node `outputPaths(NODES[type].outputs)` plus `trigger.payload` → grouped `<Command>` list; selecting inserts `{{ key.path }}` at the cursor.
- [ ] Canvas: after a run, edges whose `sourceHandle` (or "out") equals the source step's recorded `handle` render solid (`stroke-primary`), other edges from a completed node render dimmed (`opacity-40`); nodes with `skipped` rows render a dashed muted ring. Requires `handle` in `steps.byExecution` (already stored).
- [ ] Verify: Manual (sample `{ "score": 7 }`) → Condition `{{ manual_trigger_1.payload.score }} > 5` → true: Set → false: Set; run with 7 then 3; the untaken branch greys out each time; the picker lists `manual_trigger_1.payload` and the step row shows no warnings. `pnpm typecheck && pnpm lint && pnpm test`. Commit `feat(canvas): config panel, variable picker, branch styling`.
