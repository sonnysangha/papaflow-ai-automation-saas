// `{{ node_key.path }}` templates: path lookups only — no `eval`, no `new Function`, no
// expressions. `runNode` resolves `node.data.inputs` against the run's outputs before
// `def.inputs.parse()`, so a template may stand where the schema expects any type.

/** A string that is nothing but one template resolves to the referenced value, not to text. */
const WHOLE_TEMPLATE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
/** Every template inside a string. Used for embedded resolution, `extractRefs` and renames. */
const TEMPLATE = /\{\{\s*([^}]+?)\s*\}\}/g;
/** The node key (or reserved `trigger` / `$item`) at the head of a path. */
const ROOT_SEGMENT = /^[^.[\]]+/;

export interface ResolveResult {
  value: unknown;
  /** One `"{{ a.b }}: not found"` per unresolved path, in first-seen order. */
  warnings: string[];
}

const NOT_FOUND = { found: false, value: undefined } as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `a.b[0].c` → `["a", "b", "0", "c"]`; array indices are just keys. */
function segmentsOf(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim());
}

/**
 * Own properties only: `{{ toString }}` must miss rather than return `Function.prototype`.
 * A key that exists but holds `undefined` counts as missing, so it warns like a typo does.
 */
function lookup(path: string, ctx: Record<string, unknown>): { found: boolean; value: unknown } {
  let current: unknown = ctx;
  for (const segment of segmentsOf(path)) {
    if (segment === "" || typeof current !== "object" || current === null) return NOT_FOUND;
    if (!Object.hasOwn(current, segment)) return NOT_FOUND;
    current = (current as Record<string, unknown>)[segment];
  }
  return current === undefined ? NOT_FOUND : { found: true, value: current };
}

/** Objects and arrays become JSON inside a longer string; everything else becomes text. */
function stringify(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

/** Rebuilds objects and arrays, mapping every string leaf. Object keys are left alone. */
function mapStrings(value: unknown, map: (text: string) => unknown): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, map));
  if (isPlainObject(value)) {
    const mapped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) mapped[key] = mapStrings(entry, map);
    return mapped;
  }
  return value;
}

function resolveString(
  text: string,
  ctx: Record<string, unknown>,
  warn: (path: string) => void,
): unknown {
  const whole = WHOLE_TEMPLATE.exec(text);
  if (whole) {
    const path = whole[1].trim();
    const hit = lookup(path, ctx);
    if (hit.found) return hit.value;
    warn(path);
    return "";
  }
  return text.replace(TEMPLATE, (_match, raw: string) => {
    const path = raw.trim();
    const hit = lookup(path, ctx);
    if (hit.found) return stringify(hit.value);
    warn(path);
    return "";
  });
}

/**
 * Resolves every template in `value` against `ctx` (`{ [nodeKey]: output, trigger, $item }`),
 * deep-walking objects and arrays. A string that is exactly one template keeps the raw type of
 * what it points at; templates inside a longer string are stringified. Unresolved paths become
 * `""` and add a warning. The input is never mutated.
 */
export function resolveTemplates(value: unknown, ctx: Record<string, unknown>): ResolveResult {
  const warnings: string[] = [];
  const warn = (path: string) => {
    const warning = `{{ ${path} }}: not found`;
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  return { value: mapStrings(value, (text) => resolveString(text, ctx, warn)), warnings };
}

/** Every template path in `value`, unique and in first-seen order (`["a.b", "c"]`). */
export function extractRefs(value: unknown): string[] {
  const refs: string[] = [];
  // `mapStrings` only for the walk: the rebuilt copy is thrown away.
  mapStrings(value, (text) => {
    for (const match of text.matchAll(TEMPLATE)) {
      const path = match[1].trim();
      if (path && !refs.includes(path)) refs.push(path);
    }
    return text;
  });
  return refs;
}

/**
 * Renaming a node key: rewrites `{{ oldKey… }}` to `{{ newKey… }}` wherever the *root* segment
 * matches, keeping the rest of the path. `{{ other.oldKey }}` and `{{ oldKey_2.x }}` are left
 * alone. Rewritten templates come back in the canonical `{{ path }}` spacing.
 */
export function renameKeyInTemplates(value: unknown, oldKey: string, newKey: string): unknown {
  return mapStrings(value, (text) =>
    text.replace(TEMPLATE, (match: string, raw: string) => {
      const path = raw.trim();
      const root = ROOT_SEGMENT.exec(path)?.[0];
      return root === oldKey ? `{{ ${newKey}${path.slice(root.length)} }}` : match;
    }),
  );
}
