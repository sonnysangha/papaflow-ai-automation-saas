"use client";

import type { ComponentType, ReactElement, ReactNode } from "react";
import Link from "next/link";
import {
  GanttChartIcon,
  HistoryIcon,
  LayoutGridIcon,
  MoreHorizontalIcon,
  Redo2Icon,
  SaveIcon,
  SparklesIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The toolbar, folded up.
 *
 * A phone has room for the two things you came to press — Run and Publish — and nothing else, so
 * everything else the editor's one desktop row carries goes in here. These are the *same* controls
 * with the same handlers, not a reduced set: Undo and Redo still act on the canvas's history, Save
 * still reports whether there is anything to save, Runs still toggles the same drawer its own bar
 * does. Only the arrangement changes.
 */
export type EditorMenuAction = {
  id: string;
  label: string;
  /** The second line — what Save uses to say "Unsaved changes" without needing a second control. */
  description?: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** A navigation rather than a command, so the unsaved-changes guard (which watches anchor
   *  clicks) still gets a say. */
  href?: string;
  onSelect?: () => void;
};

/**
 * The seven actions the mobile toolbar hides, in the order they are offered.
 *
 * A plain function over plain values: what each one *does* belongs to the editor, what the row
 * says belongs here, and a test can read the list without a menu, a canvas or a viewport.
 */
export function editorMenuActions({
  workflowId,
  canUndo,
  canRedo,
  canTidy,
  canSave,
  saveLabel,
  runsOpen,
  onUndo,
  onRedo,
  onTidy,
  onSave,
  onBuildWithAi,
  onToggleRuns,
}: {
  workflowId: string;
  canUndo: boolean;
  canRedo: boolean;
  canTidy: boolean;
  /** Whether there is anything to write — the same condition the desktop Save button is enabled on. */
  canSave: boolean;
  /** "Saved · 2m ago", "Unsaved changes", "Saving…" — whatever the toolbar would have shown. */
  saveLabel: string;
  runsOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTidy: () => void;
  onSave: () => void;
  onBuildWithAi: () => void;
  onToggleRuns: () => void;
}): EditorMenuAction[] {
  return [
    { id: "undo", label: "Undo", icon: Undo2Icon, disabled: !canUndo, onSelect: onUndo },
    { id: "redo", label: "Redo", icon: Redo2Icon, disabled: !canRedo, onSelect: onRedo },
    {
      id: "tidy",
      label: "Tidy up",
      description: "Space every node out along its wires",
      icon: LayoutGridIcon,
      disabled: !canTidy,
      onSelect: onTidy,
    },
    {
      id: "save",
      label: "Save",
      description: saveLabel,
      icon: SaveIcon,
      disabled: !canSave,
      onSelect: onSave,
    },
    {
      id: "builder",
      label: "Build with AI",
      description: "Describe the workflow and let the Builder draw it",
      icon: SparklesIcon,
      onSelect: onBuildWithAi,
    },
    {
      id: "runs",
      label: "Runs",
      description: runsOpen ? "Hide the timeline" : "Show the timeline",
      icon: GanttChartIcon,
      onSelect: onToggleRuns,
    },
    {
      id: "run-history",
      label: "Run history",
      description: "Every run of this workflow",
      icon: HistoryIcon,
      href: `/w/${workflowId}/runs`,
    },
  ];
}

/**
 * One menu item's props, as this list needs them.
 *
 * `DropdownMenuItem` is a Base UI part and throws outside a `<Menu.Root>`, which is exactly the
 * context a static render has none of — so the row component is what it renders *into*, defaulted
 * to the real item and swapped for a plain wrapper in the test. The list itself stays pure.
 */
export type MenuItemComponent = ComponentType<{
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  render?: ReactElement;
}>;

/**
 * The rows themselves: an icon, the action, and the sentence under it.
 *
 * No hooks and no state — it is handed the actions and draws them.
 */
export function EditorMenuList({
  actions,
  item: Item = DropdownMenuItem,
}: {
  actions: readonly EditorMenuAction[];
  item?: MenuItemComponent;
}) {
  return (
    <>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Item
            key={action.id}
            disabled={action.disabled}
            onClick={action.onSelect}
            render={action.href ? <Link href={action.href} /> : undefined}
          >
            <Icon />
            <span className="flex min-w-0 flex-1 flex-col">
              <span>{action.label}</span>
              {action.description ? (
                <span className="truncate text-xs text-muted-foreground">{action.description}</span>
              ) : null}
            </span>
          </Item>
        );
      })}
    </>
  );
}

/** The `⋯` button and the menu it opens. Mobile only; the desktop toolbar has room for all of it. */
export function EditorActionsMenu({ actions }: { actions: readonly EditorMenuAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <EditorMenuList actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
