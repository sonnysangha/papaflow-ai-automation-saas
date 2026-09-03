import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  editorMenuActions,
  EditorMenuList,
  type MenuItemComponent,
} from "@/components/canvas/EditorMenu";

/**
 * The toolbar folded up.
 *
 * On a phone the editor's one desktop row does not fit — the right-hand cluster overflows a 390px
 * viewport by about a third of it — so everything but Run and Publish moves behind `⋯`. What this
 * asserts is that *everything* moved: a control that is neither on the mobile row nor in this menu
 * is a control a phone cannot reach at all.
 *
 * `DropdownMenuItem` is a Base UI part and throws outside a `<Menu.Root>`, which a static render
 * has none of, so the list renders into whatever row component it is given — the real menu item in
 * the app, a plain wrapper here.
 */
const Row: MenuItemComponent = ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
  <div data-disabled={disabled ? "true" : undefined}>{children}</div>
);

function actions(overrides: Partial<Parameters<typeof editorMenuActions>[0]> = {}) {
  return editorMenuActions({
    workflowId: "kh74hyr7xxaag4mpzpdaj6fv6d8dmy4j",
    canUndo: true,
    canRedo: true,
    canTidy: true,
    canSave: true,
    saveLabel: "Unsaved changes",
    runsOpen: false,
    onUndo: () => {},
    onRedo: () => {},
    onTidy: () => {},
    onSave: () => {},
    onBuildWithAi: () => {},
    onToggleRuns: () => {},
    ...overrides,
  });
}

describe("the mobile overflow menu", () => {
  it("carries every control the mobile toolbar has no room for", () => {
    const html = renderToStaticMarkup(<EditorMenuList actions={actions()} item={Row} />);

    for (const label of [
      "Undo",
      "Redo",
      "Tidy up",
      "Save",
      "Build with AI",
      "Runs",
      "Run history",
    ]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("lists exactly those seven, in that order", () => {
    const listed = actions().map((action) => action.label);
    expect(listed).toEqual([
      "Undo",
      "Redo",
      "Tidy up",
      "Save",
      "Build with AI",
      "Runs",
      "Run history",
    ]);
  });

  it("says where the canvas stands under Save rather than needing a second control", () => {
    expect(renderToStaticMarkup(<EditorMenuList actions={actions()} item={Row} />)).toContain(
      "Unsaved changes",
    );
    const clean = actions({ saveLabel: "Saved · 2m ago", canSave: false });
    const html = renderToStaticMarkup(<EditorMenuList actions={clean} item={Row} />);
    expect(html).toContain("Saved · 2m ago");
  });

  it("disables what the canvas cannot do yet, exactly as the desktop buttons are", () => {
    const fresh = actions({ canUndo: false, canRedo: false, canTidy: false, canSave: false });
    const byId = Object.fromEntries(fresh.map((action) => [action.id, action.disabled]));
    expect(byId).toMatchObject({ undo: true, redo: true, tidy: true, save: true });
    // Never disabled: the Builder is offered to everyone (the panel puts up its own plan wall) and
    // the runs drawer can always be opened.
    expect(byId.builder).toBeFalsy();
    expect(byId.runs).toBeFalsy();
    expect(byId["run-history"]).toBeFalsy();
  });

  it("reads the runs row as a toggle of the drawer's current state", () => {
    const closed = actions({ runsOpen: false }).find((action) => action.id === "runs");
    const opened = actions({ runsOpen: true }).find((action) => action.id === "runs");
    expect(closed?.description).toBe("Show the timeline");
    expect(opened?.description).toBe("Hide the timeline");
  });

  it("keeps run history an anchor, so the unsaved-changes guard still sees the navigation", () => {
    const history = actions().find((action) => action.id === "run-history");
    expect(history?.href).toBe("/w/kh74hyr7xxaag4mpzpdaj6fv6d8dmy4j/runs");
    expect(history?.onSelect).toBeUndefined();
  });
});
