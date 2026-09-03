import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NodeCardBody } from "@/components/canvas/WorkflowNode";

/**
 * The canvas in light mode.
 *
 * The bug this guards against was not a colour anybody typed: React Flow's `colorMode="system"`
 * read the *operating system* and put `class="dark"` on its own wrapper, which is the exact class
 * the app redefines every token under (`.dark { --background … }`) and the selector Tailwind's
 * `dark:` variant matches. A dark OS with the app set to Light therefore turned the whole flow
 * subtree dark from the inside — black pane, dark minimap, near-white text on white cards — with
 * every class in the source looking perfectly correct.
 *
 * So the checks are of two kinds: that nothing under `components/canvas/` paints with a colour
 * that only works in one theme, and that the React Flow surfaces in `app/globals.css` are painted
 * from variables that exist in both `:root` and `.dark`.
 */

const CANVAS_DIR = join(process.cwd(), "components/canvas");
const GLOBALS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function canvasSources(): { name: string; source: string }[] {
  const files: { name: string; source: string }[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else if (/\.tsx?$/.test(entry.name)) {
        files.push({ name: `${prefix}${entry.name}`, source: readFileSync(path, "utf8") });
      }
    }
  };
  walk(CANVAS_DIR, "");
  return files;
}

/** Only the React Flow half of the stylesheet — the part the canvas owns. */
function reactFlowBlock(): string {
  const start = GLOBALS.indexOf(".react-flow__controls");
  const end = GLOBALS.indexOf(".pf-chat-md");
  expect(start).toBeGreaterThan(-1);
  return GLOBALS.slice(Math.max(0, GLOBALS.lastIndexOf("/*", start)), end === -1 ? undefined : end);
}

describe("canvas sources paint in both themes", () => {
  it("never hardcodes a one-theme colour", () => {
    // A tint like `bg-amber-500/15` is fine in both themes and is how status is shown; a solid
    // near-black or near-white is not, and neither is a raw hex.
    const banned = /\b(?:text|bg|border|fill|stroke)-(?:white|black|(?:zinc|neutral|slate|gray|stone)-(?:800|900|950))\b/;
    for (const { name, source } of canvasSources()) {
      expect(`${name}: ${banned.exec(source)?.[0] ?? "clean"}`).toBe(`${name}: clean`);
    }
  });

  it("uses no raw hex colours outside a CSS variable", () => {
    for (const { name, source } of canvasSources()) {
      // `var(--primary)` is how the resizer is coloured; `#1f2937` would not be.
      const hex = /#[0-9a-fA-F]{3,8}\b/.exec(source)?.[0];
      expect(`${name}: ${hex ?? "clean"}`).toBe(`${name}: clean`);
    }
  });

  it("asks React Flow for the app's colour mode rather than the operating system's", () => {
    const canvas = readFileSync(join(CANVAS_DIR, "Canvas.tsx"), "utf8");
    expect(canvas).not.toContain('colorMode="system"');
    expect(canvas).toContain("colorMode={colorMode}");
    expect(canvas).toContain('resolvedTheme === "dark"');
  });
});

describe("the React Flow block in globals.css", () => {
  it("paints the pane, dots, minimap and controls from theme variables", () => {
    const block = reactFlowBlock();
    // The pane and its dots.
    expect(block).toMatch(/\.react-flow,\s*\n\.react-flow__pane \{[^}]*var\(--background\)/);
    expect(block).toMatch(/\.react-flow__background circle \{[^}]*var\(--border\)/);
    // The two floating panels.
    expect(block).toMatch(/\.react-flow__minimap \{[^}]*var\(--card\)/);
    expect(block).toMatch(/\.react-flow__minimap-node \{[^}]*var\(--muted-foreground\)/);
    expect(block).toMatch(/\.react-flow__controls \{[^}]*var\(--card\)/);
    expect(block).toMatch(/\.react-flow__controls-button \{[^}]*var\(--muted-foreground\)/);
    // …and the text on a node, which used to inherit React Flow's own near-white.
    expect(block).toMatch(/\.react-flow__node \{[^}]*var\(--card-foreground\)/);
  });

  it("hardcodes no colour of its own", () => {
    expect(reactFlowBlock()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(reactFlowBlock()).not.toMatch(/\b(?:rgb|hsl|oklch)\(/);
  });
});

describe("node card text", () => {
  it("states its own colour instead of inheriting one", () => {
    const html = renderToStaticMarkup(
      <NodeCardBody
        label="Post to Slack"
        summary="#alerts"
        category="chat"
        setup={{ state: "ready", problems: [] }}
      />,
    );

    expect(html).toContain("text-card-foreground");
    expect(html).not.toContain("text-white");
  });
});
