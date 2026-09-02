/**
 * Where this deployment answers inbound HTTP, as the browser should show it.
 *
 * `NEXT_PUBLIC_APP_ORIGIN` is inlined at build time and is what a deployed app must display (the
 * custom domain, a preview URL); locally, and whenever it is not set, the browser's own origin is
 * right. The server-side twin is `APP_ORIGIN` (`lib/connections-server.ts`), which is what the
 * connectors actually register with providers — this one only ever paints a string on a screen.
 *
 * Called at render rather than through an effect: every caller is a client component that only
 * exists after an interaction, so there is no server render of it to disagree with.
 */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (configured) return configured;
  return typeof window === "undefined" ? "" : window.location.origin;
}
