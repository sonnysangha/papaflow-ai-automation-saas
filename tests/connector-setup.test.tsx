import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectorSetupSection, manifestJson } from "@/components/connections/ConnectorSetup";
import { connectorCatalogue } from "@/connectors/registry";

/**
 * The block that stands where a credential cannot be pasted yet.
 *
 * Slack's bot token only exists once somebody has made a Slack app, and the manifest is the paste
 * that makes one with the right scopes first time — so the dialog has to actually *show* it,
 * verbatim and copyable, rather than link to a page describing it. `renderToStaticMarkup` because
 * the unit project runs in plain node, which is enough for the two things that matter before
 * anything is clicked: the manifest is there in full, and the section is open or closed as asked.
 */

const slack = connectorCatalogue([]).find((entry) => entry.provider === "slack");
if (!slack?.setup) {
  throw new Error("The Slack connector no longer carries setup instructions to render.");
}
const setup = slack.setup;

/** JSX escapes `"` and `'`; the manifest is nothing but quotes, so read the markup back decoded. */
function decoded(html: string): string {
  return html
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

const open = renderToStaticMarkup(
  <ConnectorSetupSection name={slack.name} setup={setup} defaultOpen />,
);

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
      const at = html.indexOf(step, cursor);
      expect(at, `step not rendered in order: ${step}`).toBeGreaterThan(-1);
      cursor = at;
    }
    expect(setup.steps.length).toBeGreaterThan(1);
  });

  it("shows the manifest itself, whole and indented", () => {
    // Not a summary and not a link: this exact text is what goes into Slack's box.
    expect(decoded(open)).toContain(manifestJson(setup.manifest));
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
    const closed = renderToStaticMarkup(
      <ConnectorSetupSection name={slack.name} setup={setup} defaultOpen={false} />,
    );

    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toContain("hidden=\"\"");

    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain("hidden=\"\"");
    // Collapsed, not unmounted: the heading is still the way back to it.
    expect(closed).toContain("Set up the Slack app");
  });
});
