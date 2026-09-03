import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { codeLanguage, MessageMarkdown, safeHref } from "@/components/canvas/MessageMarkdown";

/**
 * The Builder agent's replies pass through `MessageMarkdown` before they reach a browser, which
 * makes this the boundary where model output stops being a string and starts being DOM. The tests
 * that matter are therefore about what it refuses to build — no script, no image, no `javascript:`
 * href — as much as about headings and lists.
 *
 * `renderToStaticMarkup` because the unit project runs in plain node: no jsdom, no DOM APIs, just
 * the HTML the component would have produced.
 */

const render = (markdown: string) => renderToStaticMarkup(<MessageMarkdown>{markdown}</MessageMarkdown>);

/** Fenced blocks, written as lines so the fences do not have to be escaped in a template literal. */
const lines = (...rows: string[]) => rows.join("\n");

describe("MessageMarkdown", () => {
  it("wraps everything in the scoped class", () => {
    expect(render("hello")).toContain('class="pf-chat-md"');
  });

  it("renders headings, lists and fenced code as elements", () => {
    const html = render(
      lines(
        "# Build a workflow",
        "",
        "1. Add a trigger",
        "2. Add a node",
        "",
        "- one",
        "- two",
        "",
        "```ts",
        "const workflow = 1;",
        "```",
      ),
    );

    expect(html).toContain("<h1>Build a workflow</h1>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>Add a trigger</li>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("<pre>");
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("const workflow = 1;");
  });

  it("labels a fenced block with its language, and leaves an unlabelled one alone", () => {
    expect(render(lines("```python", "x = 1", "```"))).toContain(
      '<span class="pf-chat-md-lang">python</span>',
    );
    expect(render(lines("```", "plain", "```"))).not.toContain("pf-chat-md-lang");
  });

  it("does not throw on an unterminated fence, and still renders the block", () => {
    let html = "";
    expect(() => {
      html = render(lines("Here is the step:", "", "```ts", "const half = "));
    }).not.toThrow();

    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("const half =");
  });

  it("does not throw on markdown caught mid-token while streaming", () => {
    for (const partial of ["#", "# Hea", "**bo", "| a | b", "| a | b |\n| -", "[link](", "`ab"]) {
      expect(() => render(partial), partial).not.toThrow();
    }
  });

  it("renders GFM: tables and strikethrough", () => {
    const html = render(lines("| node | kind |", "| --- | --- |", "| Slack | action |", "", "~~gone~~"));

    expect(html).toContain("<table>");
    expect(html).toContain("<th>node</th>");
    expect(html).toContain("<td>Slack</td>");
    expect(html).toContain("<del>gone</del>");
  });

  it("renders inline code, blockquotes and emphasis", () => {
    const html = render(lines("Use `slack.postMessage` for **this**.", "", "> a note"));

    expect(html).toContain("<code>slack.postMessage</code>");
    expect(html).toContain("<strong>this</strong>");
    expect(html).toContain("<blockquote>");
  });

  it("escapes raw HTML instead of executing it", () => {
    const html = render(
      lines("Before", "", "<script>alert('pwned')</script>", "", 'After <img src="x" onerror="alert(1)"> end'),
    );

    // Present as characters…
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    // …and never as elements.
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<img\b/i);
  });

  it("escapes raw HTML that would otherwise style or frame the panel", () => {
    const html = render('<iframe src="https://evil.test"></iframe><style>body{display:none}</style>');

    expect(html).not.toMatch(/<iframe\b/i);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).toContain("&lt;iframe");
  });

  it("opens an allowed link in a new tab, safely", () => {
    const html = render("See the [docs](https://example.com/docs) and [mail us](mailto:hi@example.com).");

    expect(html).toContain(
      '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">docs</a>',
    );
    expect(html).toContain('href="mailto:hi@example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("neutralises a javascript: or data: link, keeping the words", () => {
    const html = render("[click me](javascript:alert(1)) or [this](data:text/html,<h1>hi</h1>)");

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toMatch(/<a\b/);
    expect(html).toContain("<span>click me</span>");
    expect(html).toContain("<span>this</span>");
  });

  it("drops a relative link rather than pointing it at the app", () => {
    const html = render("[settings](/settings/connections)");

    expect(html).not.toMatch(/<a\b/);
    expect(html).toContain("<span>settings</span>");
  });
});

describe("safeHref", () => {
  it("keeps http, https and mailto", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("http://example.com/")).toBe("http://example.com/");
    expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
  });

  it("refuses every other scheme, however it is spelled", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      // The URL parser strips the tab and the newline, so neither hides the scheme.
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      " javascript:alert(1)",
      "data:text/html;base64,PHN2Zz4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(safeHref(href), href).toBeNull();
    }
  });

  it("refuses relative, empty and missing hrefs", () => {
    expect(safeHref("/settings")).toBeNull();
    expect(safeHref("./relative")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe("codeLanguage", () => {
  it("reads the language out of the hast class name, in either shape", () => {
    expect(codeLanguage(["language-ts"])).toBe("ts");
    expect(codeLanguage("language-JSON")).toBe("json");
    expect(codeLanguage(["hljs", "language-c++"])).toBe("c++");
  });

  it("is null when there is no language to show", () => {
    expect(codeLanguage(undefined)).toBeNull();
    expect(codeLanguage("")).toBeNull();
    expect(codeLanguage(["hljs"])).toBeNull();
    expect(codeLanguage(true)).toBeNull();
  });
});
