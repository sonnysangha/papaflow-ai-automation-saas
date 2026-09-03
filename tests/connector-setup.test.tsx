import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorSetupSection, manifestJson } from "@/components/connections/ConnectorSetup";
import { APP_ORIGIN_TOKEN, substituteAppOrigin } from "@/connectors/define";
import { connectorCatalogue } from "@/connectors/registry";
import { SLACK_EVENTS_PATH } from "@/connectors/slack";

/**
 * The block that stands where a credential cannot be pasted yet.
 *
 * Slack's bot token only exists once somebody has made a Slack app, and the manifest is the paste
 * that makes one with the right scopes first time — so the dialog has to actually *show* it,
 * verbatim and copyable, rather than link to a page describing it. `renderToStaticMarkup` because
 * the unit project runs in plain node, which is enough for the things that matter before anything
 * is clicked: the manifest is there in full, the section is open or closed as asked, and the
 * Request URL inside it is this deployment's own.
 *
 * That last one is the reason this component substitutes at all. The catalogue is built at module
 * load, with no request and no `window`, so the connector writes `{{APP_ORIGIN}}` and the origin is
 * only known here (`lib/app-origin.ts`). A manifest that reached the clipboard with the token still
 * in it would be a Slack app pointed at nothing.
 */

const slack = connectorCatalogue([]).find((entry) => entry.provider === "slack");
if (!slack?.setup) {
  throw new Error("The Slack connector no longer carries setup instructions to render.");
}
const setup = slack.setup;
/** Read out here, where the `find` above has been narrowed, so `render` closes over a string. */
const name = slack.name;

/** A deployed origin, which is the only kind Slack accepts. */
const ORIGIN = "https://papaflow.vercel.app";

/** JSX escapes `"` and `'`; the manifest is nothing but quotes, so read the markup back decoded. */
function decoded(html: string): string {
  return html
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/**
 * Renders the section as a browser on `origin` would see it. `NEXT_PUBLIC_APP_ORIGIN` is what
 * `appOrigin()` reads when there is no `window`, which is exactly this environment.
 */
function render(origin: string = ORIGIN, defaultOpen = true): string {
  vi.stubEnv("NEXT_PUBLIC_APP_ORIGIN", origin);
  return renderToStaticMarkup(
    <ConnectorSetupSection name={name} setup={setup} defaultOpen={defaultOpen} />,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const open = render();

describe("manifestJson", () => {
  it("formats a manifest the way Slack's paste box wants it", () => {
    expect(manifestJson({ display_information: { name: "PapaFlow" } })).toBe(
      '{\n  "display_information": {\n    "name": "PapaFlow"\n  }\n}',
    );
  });

  it("round-trips the connector's own manifest, so what is copied is what was declared", () => {
    expect(JSON.parse(manifestJson(setup.manifest))).toEqual(setup.manifest);
  });
});

describe("ConnectorSetupSection", () => {
  it("names itself after the app it creates", () => {
    expect(open).toContain("Set up the Slack app");
    expect(open).toContain(setup.title);
  });

  it("renders every step, in order", () => {
    const html = decoded(open);
    let cursor = 0;
    for (const step of setup.steps) {
      const at = html.indexOf(substituteAppOrigin(step, ORIGIN), cursor);
      expect(at, `step not rendered in order: ${step}`).toBeGreaterThan(-1);
      cursor = at;
    }
    expect(setup.steps.length).toBeGreaterThan(1);
  });

  it("shows the manifest itself, whole and indented", () => {
    // Not a summary and not a link: this exact text is what goes into Slack's box.
    expect(decoded(open)).toContain(substituteAppOrigin(manifestJson(setup.manifest), ORIGIN));
  });

  it("puts this deployment's own origin in the URL Slack is handed", () => {
    const html = decoded(open);

    // The whole point: what is rendered — and so what the copy button copies — is a real URL.
    expect(html).toContain(`"request_url": "${ORIGIN}${SLACK_EVENTS_PATH}"`);
    expect(html).toContain(`${ORIGIN}${SLACK_EVENTS_PATH}`);
    expect(html).not.toContain(APP_ORIGIN_TOKEN);
    // And no leftover of the placeholder this replaced.
    expect(html).not.toContain("papaflow.example.com");
    expect(html).not.toContain("CONNECTION_ID");

    // A different deployment gets its own, from the same declared manifest.
    expect(decoded(render("https://acme.example.org"))).toContain(
      `"request_url": "https://acme.example.org${SLACK_EVENTS_PATH}"`,
    );
  });

  it("says so when the origin is not one Slack can call", () => {
    // Slack has no localhost exception, so a manifest copied from a laptop points at nothing —
    // worth one line next to the JSON rather than a silently broken app.
    const local = decoded(render("http://localhost:3000"));
    expect(local).toContain("Slack only accepts public HTTPS URLs");
    expect(local).toContain("or a tunnel while developing");
    // The manifest is still rendered and still copyable; the note is advice, not a wall.
    expect(local).toContain("http://localhost:3000/api/events/slack");

    // Nothing to warn about on a deployed origin.
    expect(decoded(open)).not.toContain("only accepts public HTTPS URLs");
  });

  it("keeps the manifest scrolling inside its own box", () => {
    // A manifest line is longer than the dialog; without this the `<pre>` widens the whole form.
    expect(open).toContain("overflow-auto");
  });

  it("offers the copy button and the way into Slack's own flow", () => {
    expect(open).toContain("Copy manifest");
    expect(open).toContain("https://api.slack.com/apps?new_app=1");
    expect(open).toContain("Create new app");
  });

  it("starts open when asked, and collapsed when not", () => {
    const closed = render(ORIGIN, false);

    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain("hidden=\"\"");

    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain("hidden=\"\"");
    // Collapsed, not unmounted: the heading is still the way back to it.
    expect(closed).toContain("Set up the Slack app");
  });
});
