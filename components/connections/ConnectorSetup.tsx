"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { APP_ORIGIN_TOKEN, substituteAppOrigin, type ConnectorSetup } from "@/connectors/define";
import { appOrigin } from "@/lib/app-origin";

/**
 * The half of "Add connection" that comes *before* there is anything to paste.
 *
 * Slack is the connector whose credential does not exist yet when the user arrives: a bot token
 * only exists once they have created a Slack app with the right scopes, and clicking twenty scope
 * checkboxes by hand is where people give up. Slack accepts a manifest instead, so the dialog hands
 * one over — the connector's own `setup.manifest`, rendered verbatim, with a copy button.
 *
 * Nothing here is secret or per-org: `connectorCatalogue()` carries `setup` to the browser as plain
 * JSON, and the manifest is the same for every organisation.
 */

/** Where Slack's own "create an app from a manifest" flow starts. */
const NEW_APP_URL = "https://api.slack.com/apps?new_app=1";

/** Exactly what goes on the clipboard, and exactly what the `<pre>` shows — one source for both. */
export function manifestJson(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Whether an origin is one a provider can actually call back.
 *
 * Slack takes `https` URLs only and has no localhost exception, so a manifest pasted from a laptop
 * carries a Request URL that will never be reached. That is not an error worth blocking on — the
 * rest of the manifest is exactly right, and the app has to exist before a token can be pasted —
 * but it is worth saying out loud, once, next to the JSON.
 */
function isPublicHttpsOrigin(origin: string): boolean {
  return origin.startsWith("https://");
}

type CopyState = "idle" | "copied" | "selected";

export type ConnectorSetupProps = {
  /** The connector's name, for the section's own heading: "Set up the Slack app". */
  name: string;
  setup: ConnectorSetup;
  /**
   * Whether the section starts open. The dialog passes "the credential field is still empty",
   * which is the honest test for *is this person here to make an app or to paste a token they
   * already have* — and it is read once, so typing does not collapse the steps mid-flow.
   */
  defaultOpen: boolean;
};

export function ConnectorSetupSection({ name, setup, defaultOpen }: ConnectorSetupProps) {
  const regionId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState<CopyState>("idle");
  const manifestRef = useRef<HTMLPreElement>(null);

  /**
   * The manifest names this deployment's own inbound URL, which a catalogue built at module load
   * cannot know — so the connector writes `{{APP_ORIGIN}}` and it is swapped for the real origin
   * here, in the one place that has one. Steps get the same treatment: they quote the URL.
   *
   * Read during render rather than in an effect: this section only exists inside a dialog the user
   * has opened, so there is no server render of it to disagree with (`lib/app-origin.ts`).
   */
  const origin = appOrigin();
  const json = substituteAppOrigin(manifestJson(setup.manifest), origin);
  const steps = setup.steps.map((step) => substituteAppOrigin(step, origin));

  // Only worth saying for a manifest that actually carries a callback URL.
  const needsPublicOrigin =
    !isPublicHttpsOrigin(origin) &&
    (manifestJson(setup.manifest) + setup.steps.join(" ")).includes(APP_ORIGIN_TOKEN);

  // "Copied" is a confirmation, not a mode: it says the click worked and then gets out of the way.
  useEffect(() => {
    if (copied === "idle") return;
    const timer = setTimeout(() => setCopied("idle"), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  /**
   * The clipboard is not always available — an insecure origin, a browser that refuses without a
   * permission — and a copy button that silently does nothing is worse than no button. The fallback
   * selects the manifest so the user's own copy shortcut works on it.
   */
  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied("copied");
      return;
    } catch {
      // Falls through to selecting the text.
    }

    const node = manifestRef.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    setCopied("selected");
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full min-w-0 items-center gap-1.5 text-left text-sm font-medium"
      >
        {open ? (
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">Set up the {name} app</span>
      </button>

      {/* `hidden` rather than unmounted: the manifest keeps its scroll position and the copy
          button keeps its ref across a collapse. */}
      <div id={regionId} hidden={!open} className="grid min-w-0 gap-2">
        <p className="text-xs text-muted-foreground">{setup.title}</p>

        <ol className="ml-4 grid list-decimal gap-1 text-xs break-words text-muted-foreground marker:text-muted-foreground/70">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        {/* One expression, not interpolated text: React SSR would otherwise split the sentence
            into separate text nodes with `<!-- -->` between them. */}
        {needsPublicOrigin ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {`${name} only accepts public HTTPS URLs — use your deployed origin (e.g. https://papaflow.vercel.app) or a tunnel while developing.`}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <a
            href={NEW_APP_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 truncate text-xs underline underline-offset-4"
          >
            Create new app → From a manifest
            <ExternalLinkIcon aria-hidden className="ml-1 inline size-3 align-[-0.1em]" />
          </a>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={copyManifest}>
            {copied === "idle" ? <CopyIcon /> : <CheckIcon />}
            {copied === "copied" ? "Copied" : copied === "selected" ? "Selected" : "Copy manifest"}
          </Button>
        </div>

        {/* `min-w-0` and its own scrollbar: a manifest line is longer than a 448px dialog, and
            without both the `<pre>` sizes to its widest line and stretches the whole form. */}
        <pre
          ref={manifestRef}
          className="max-h-56 min-w-0 overflow-auto rounded-md border border-border bg-background p-2 font-mono text-[11px] leading-relaxed"
        >
          {json}
        </pre>

        {copied === "selected" ? (
          <p className="text-xs text-muted-foreground">
            The clipboard was not available — the manifest is selected, so copy it with your
            keyboard.
          </p>
        ) : null}
      </div>
    </div>
  );
}
