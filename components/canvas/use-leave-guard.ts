"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * "You have unsaved changes" for a page the App Router does not let us block.
 *
 * Next.js has no route-change interception: `next/link` renders an ordinary `<a>` and calls
 * `router.push()` from its own click handler, and there is no `useBlocker`. So this hook guards the
 * two exits a user actually takes, and is honest about the rest:
 *
 * 1. **Leaving the site** (reload, close, typed URL, an external link) — `beforeunload`. The
 *    browser shows its own two-button prompt; the wording is not ours and cannot be.
 * 2. **An in-app link** — a capture-phase click listener on `document`, which runs before React's
 *    delegated handler and therefore before `next/link`'s. The click is cancelled and the caller
 *    gets a `proceed` callback that performs the same navigation later.
 * 3. **The browser Back button** — while the guard is on, a duplicate history entry for the current
 *    URL is pushed. Back then lands on an entry with the same URL, so no route change happens; the
 *    `popstate` re-pushes the duplicate (cancelling the press) and the caller gets a `proceed` that
 *    goes back two entries, past both copies, to where Back was actually heading.
 *
 * Known limits, all of them deliberate:
 *
 * - **Programmatic navigation elsewhere is not caught.** A `router.push()` inside another component
 *   — Clerk's `<OrganizationSwitcher>` and `<UserButton>` are the ones on this page — fires no click
 *   on an `<a href>` and no `popstate`. Guarding those would mean patching the router.
 * - **Forward is not guarded**, only Back. Forward from the editor is only reachable after a Back
 *   that already went through the dialog.
 * - The duplicate history entry is popped when the guard turns off (after a save), but only in
 *   answer to a real Back press — never speculatively, because calling `history.back()` while some
 *   other navigation is in flight is worse than an extra entry. One consequence: if you leave the
 *   editor by a link while it is dirty and come back to it later, the duplicate is still there and
 *   your first Back press on the *clean* editor does nothing visible. A second press leaves.
 * - `beforeunload` is only honoured when the page has been interacted with, and a crash, a `kill`
 *   or a phone reclaiming memory prompts nobody. Explicit Save is what makes work durable; this is
 *   a safety net over it.
 */

/** The marker written onto the duplicate history entry. Debugging aid only — nothing reads it. */
const GUARD_STATE_KEY = "__papaflowLeaveGuard";

/** The parts of a click on an anchor that decide whether it is ours to intercept. */
export type LinkClick = {
  href: string | null | undefined;
  /** The anchor's `target`; anything but the current tab is left alone. */
  target?: string | null;
  /** `<a download>` saves a file instead of navigating. */
  download?: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
};

/**
 * Whether `href` points at a page of this app — same origin over http(s).
 *
 * `mailto:`, `tel:`, `blob:` and `javascript:` are all out, and so is any absolute URL to another
 * host: leaving for those is a `beforeunload` matter, not something we can offer to save first.
 */
export function isInternalHref(
  href: string | null | undefined,
  currentUrl: string,
): boolean {
  if (typeof href !== "string" || href.length === 0) return false;
  try {
    const url = new URL(href, currentUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.origin === new URL(currentUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Whether a click on an anchor should be stopped and asked about.
 *
 * Everything that would not have navigated *this* tab away from *this* page is let through:
 * middle and right clicks, ⌘/Ctrl/Shift/Alt clicks (new tab, new window, download), `target`ed
 * links, downloads, external URLs, a click something else already handled, and links to the page
 * we are already on — a bare `#anchor` moves the scroll position, not the editor.
 */
export function shouldGuardClick(click: LinkClick, currentUrl: string): boolean {
  if (click.defaultPrevented) return false;
  if (click.button !== 0) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (click.download) return false;
  if (click.target && click.target !== "_self") return false;

  const href = click.href;
  if (typeof href !== "string" || !isInternalHref(href, currentUrl)) return false;

  const next = new URL(href, currentUrl);
  const here = new URL(currentUrl);
  return next.pathname !== here.pathname || next.search !== here.search;
}

export type LeaveGuardOptions = {
  /** Whether there is anything to lose. Nothing is listened for while this is false. */
  enabled: boolean;
  /**
   * Called instead of the navigation, with the callback that performs it. Call `proceed()` to let
   * the user go, or do nothing to keep them here.
   */
  onGuard: (proceed: () => void) => void;
};

export function useLeaveGuard({ enabled, onGuard }: LeaveGuardOptions): void {
  const router = useRouter();

  // Read through a ref so a caller that re-creates the callback every render does not tear every
  // listener down and put it back.
  const onGuardRef = useRef(onGuard);
  useEffect(() => {
    onGuardRef.current = onGuard;
  }, [onGuard]);

  // Set the moment the user has chosen to leave, so the navigation we perform ourselves is not
  // caught by our own listeners.
  const leavingRef = useRef(false);
  // Whether our duplicate history entry is outstanding.
  const armedRef = useRef(false);

  // 1. Leaving the site altogether.
  useEffect(() => {
    if (!enabled) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (leavingRef.current) return;
      // Both, on purpose: `preventDefault` is the standard, `returnValue` is what older Safari and
      // Firefox act on.
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled]);

  // 2. In-app links.
  useEffect(() => {
    if (!enabled) return;

    function onClick(event: MouseEvent) {
      if (leavingRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const click: LinkClick = {
        // The attribute rather than `anchor.href`, so a relative href stays relative and
        // `isInternalHref` resolves it against the page we are actually on.
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download"),
        button: event.button,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        defaultPrevented: event.defaultPrevented,
      };
      if (!shouldGuardClick(click, window.location.href)) return;

      // Capture phase: this runs before React's delegated listener, so `next/link` never sees the
      // click and no navigation starts behind the dialog.
      event.preventDefault();
      event.stopPropagation();

      const href = anchor.href;
      onGuardRef.current(() => {
        leavingRef.current = true;
        router.push(href);
      });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, router]);

  // 3. The Back button.
  useEffect(() => {
    function onPopState() {
      if (leavingRef.current) return;

      if (!enabled) {
        // Guard off with our duplicate still in the stack: this press only walked off the copy, so
        // finish the journey the user asked for rather than leaving them on the same page.
        if (!armedRef.current) return;
        armedRef.current = false;
        window.history.back();
        return;
      }

      // Put the duplicate back — the URL never changed, so this is the whole of "cancel that Back".
      pushGuardEntry();
      onGuardRef.current(() => {
        leavingRef.current = true;
        // Past our duplicate *and* past the editor's own entry, to wherever Back was going.
        window.history.go(-2);
      });
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enabled]);

  // Arming is separate from the listener above because it must not happen in an effect cleanup:
  // cleanups also run on unmount, and pushing or popping history entries while the page is already
  // leaving fights the navigation in flight.
  useEffect(() => {
    if (!enabled || armedRef.current) return;
    // Only once the App Router has stamped this entry as its own. An entry it does not recognise is
    // one it answers a `popstate` for by reloading the page, which is the opposite of a guard. In
    // practice it has stamped it long before anyone has edited anything.
    if (typeof window.history.state !== "object" || window.history.state === null) return;
    armedRef.current = true;
    pushGuardEntry();
  }, [enabled]);
}

/**
 * A second history entry for the URL we are already on.
 *
 * The current `history.state` is spread through it, which matters more than it looks: the App
 * Router marks its own entries with `__NA` and hangs its route tree off
 * `__PRIVATE_NEXTJS_INTERNALS_TREE`, refuses to handle a `popstate` for an entry without them (it
 * reloads the page instead), and its patched `pushState` passes any state that already carries
 * `__NA` straight through to the native one. So this pushes a twin of the current entry and
 * dispatches no router action at all — the entry exists, and nothing else moves.
 */
function pushGuardEntry(): void {
  const current = window.history.state;
  const state =
    typeof current === "object" && current !== null
      ? { ...current, [GUARD_STATE_KEY]: true }
      : { [GUARD_STATE_KEY]: true };
  window.history.pushState(state, "", window.location.href);
}
