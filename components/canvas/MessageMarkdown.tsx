"use client";

import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * The Builder agent's replies, as Markdown.
 *
 * `react-markdown` was picked over `streamdown` on purpose. Both support React 19 and both can be
 * styled under Tailwind 4 without a config file, but streamdown renders model HTML through
 * `rehype-raw` + `rehype-sanitize` — `<img onerror=…>` becomes a real (scrubbed) element — while
 * the rule here is that HTML from a model is *text*. `react-markdown` does exactly that already:
 * it hands `remark-rehype` `allowDangerousHtml: true` and then rewrites every `raw` node into a
 * text node, so `<script>` arrives on screen as characters and never as an element. Its styling
 * also stays ours: every rule lives under `.pf-chat-md` in `app/globals.css`, rather than being
 * baked into the library's own utility classes and a global stylesheet we would have to import.
 *
 * Streaming is safe by construction: the component is synchronous and re-parses the string it is
 * given, and remark closes whatever the model has not finished writing (an open fence becomes a
 * code block, an open `**` stays literal), so a half-written reply renders rather than throwing.
 */

/** Hoisted: a fresh array on every render would re-create the unified processor each time. */
const REMARK_PLUGINS = [remarkGfm];

const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Fenced-code class names, as `remark-rehype` writes them: `language-ts`, `language-c++`. */
const LANGUAGE_CLASS = /^language-([\w+#.-]+)$/;

/**
 * The href we are willing to put in the DOM, or `null` for one we are not.
 *
 * Parsing rather than string-matching is the point: the URL parser strips the tabs, newlines and
 * leading control characters that `jAvA\nscript:` tricks rely on, and normalising through
 * `url.href` means the browser follows the same string we vetted. A relative href has no protocol,
 * fails to parse without a base, and is dropped — the agent has no reason to link inside the app.
 */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return SAFE_LINK_SCHEMES.has(url.protocol) ? url.href : null;
}

/** The language of a fenced block, from the `class` hast puts on its `<code>`. */
export function codeLanguage(className: unknown): string | null {
  const names = Array.isArray(className)
    ? className
    : typeof className === "string"
      ? className.split(/\s+/)
      : [];

  for (const name of names) {
    const match = LANGUAGE_CLASS.exec(String(name));
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Applied to every URL attribute before the components below see it. Links get our allow-list;
 * anything else (an image `src`) keeps react-markdown's own protocol check.
 */
function transformUrl(url: string, key: string): string {
  return key === "href" ? (safeHref(url) ?? "") : defaultUrlTransform(url);
}

const COMPONENTS: Components = {
  a({ href, children }) {
    const safe = safeHref(href);
    // A `javascript:`/`data:` link is neutralised by dropping the anchor, not the words: the reader
    // still sees what the agent wrote, with nothing to click.
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  pre({ node, children }) {
    const code = node?.children.find(
      (child) => child.type === "element" && child.tagName === "code",
    );
    const language = code?.type === "element" ? codeLanguage(code.properties.className) : null;

    return (
      <div className="pf-chat-md-block">
        {language ? <span className="pf-chat-md-lang">{language}</span> : null}
        <pre>{children}</pre>
      </div>
    );
  },
};

export function MessageMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("pf-chat-md", className)}>
      <Markdown components={COMPONENTS} remarkPlugins={REMARK_PLUGINS} urlTransform={transformUrl}>
        {children}
      </Markdown>
    </div>
  );
}
