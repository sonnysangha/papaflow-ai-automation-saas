/**
 * The editor's keyboard shortcuts, in one place so the popover that lists them and the handlers
 * that implement them cannot drift apart.
 *
 * They are deliberately few. A canvas that needs a cheat sheet has failed; these are the four
 * things you do often enough that reaching for the mouse becomes the slow part.
 */

/** The node search box. `/` focuses it from anywhere on the canvas. */
export const NODE_SEARCH_INPUT_ID = "papaflow-node-search";

export type Shortcut = {
  /** Rendered as one `<kbd>` per entry. `⌘` is substituted for Ctrl on Apple platforms. */
  keys: string[];
  description: string;
};

export const CANVAS_SHORTCUTS: readonly Shortcut[] = [
  { keys: ["Mod", "Enter"], description: "Run the workflow" },
  { keys: ["/"], description: "Search nodes" },
  { keys: ["Esc"], description: "Close the settings panel" },
  { keys: ["Delete"], description: "Delete the selected node or edge" },
];

/**
 * Whether a key press belongs to whatever the user is typing in rather than to the canvas.
 *
 * Everything that takes text is excluded, including `contenteditable` (the Builder chat) and
 * anything inside an open dialog — a shortcut that fires while you are naming a workflow would be
 * worse than no shortcut at all.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** True for ⌘ on Apple platforms and Ctrl everywhere else, so one binding suits both. */
export function hasModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}
