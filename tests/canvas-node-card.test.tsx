import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { nodeSummary } from "@/components/canvas/node-summary";
import type { NodeSetup } from "@/components/canvas/node-setup";
import { NodeCardBody } from "@/components/canvas/WorkflowNode";

/**
 * The card as it is actually drawn, minus React Flow.
 *
 * `WorkflowNode` itself cannot be rendered here — `Handle` and `NodeResizer` read the flow store,
 * which only exists inside a mounted `<ReactFlow>` — so the part with the words in it is its own
 * component, and this is that component. Everything the card claims to say at a glance is asserted
 * against markup rather than against a description of markup.
 */

const READY: NodeSetup = { state: "ready", problems: [] };

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe("node card", () => {
  it("shows the name and the configuration summary on two lines", () => {
    const inputs = { method: "POST", url: "https://api.stripe.com/v1/charges" };
    const html = render(
      <NodeCardBody
        label="Charge the customer"
        summary={nodeSummary("http.request", inputs) ?? ""}
        icon="Globe"
        category="action"
        status="success"
        setup={READY}
      />,
    );

    expect(html).toContain("Charge the customer");
    expect(html).toContain("POST https://api.stripe.com/v1/charges");
    // No badge on a card with nothing wrong with it.
    expect(html).not.toContain("Needs setup");
  });

  it("tints the icon tile by category", () => {
    const ai = render(
      <NodeCardBody label="Draft a reply" summary="gpt-5-mini" category="ai" setup={READY} />,
    );
    const logic = render(
      <NodeCardBody label="Is it urgent?" summary="2 cases" category="logic" setup={READY} />,
    );

    expect(ai).toContain("bg-sky-500/15");
    expect(logic).toContain("bg-amber-500/15");
  });

  it("says what is missing, and keeps saying what the last run did", () => {
    const html = render(
      <NodeCardBody
        label="Post to Slack"
        summary="Choose a connection"
        category="chat"
        // Green from this morning's run, and still not runnable today: two separate things, so
        // both are on the card at once.
        status="success"
        setup={{ state: "needs_connection", problems: ["Choose a connection"] }}
      />,
    );

    expect(html).toContain("Connect");
    expect(html).toContain("Choose a connection");
    expect(html).toContain("bg-amber-500/15");
    // The status ring keeps its own colour rather than being taken over by the warning.
    expect(html).toContain("bg-emerald-500");
  });

  it("marks a node the plan refuses more quietly than one that is merely unfinished", () => {
    const html = render(
      <NodeCardBody
        label="Agent"
        summary="Model not set"
        category="ai"
        setup={{ state: "unavailable", problems: ["Not on your plan"] }}
      />,
    );

    expect(html).toContain("Upgrade");
    expect(html).toContain("bg-zinc-500/15");
    expect(html).not.toContain("bg-amber-500/15");
  });
});
