import type { NodeCategory } from "./define";

export interface CategoryMeta {
  id: NodeCategory;
  label: string;
}

/** Display order of the node sidebar groups. */
export const CATEGORIES: readonly CategoryMeta[] = [
  { id: "trigger", label: "Triggers" },
  { id: "logic", label: "Logic" },
  { id: "ai", label: "AI" },
  { id: "chat", label: "Chat" },
  { id: "data", label: "Data" },
  { id: "action", label: "Actions" },
];

export function categoryLabel(id: NodeCategory): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export function categoryOrder(id: NodeCategory): number {
  const index = CATEGORIES.findIndex((category) => category.id === id);
  return index === -1 ? CATEGORIES.length : index;
}
