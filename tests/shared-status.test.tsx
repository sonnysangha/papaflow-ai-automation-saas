import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunStatusDot, RunStatusPill, WorkflowStatusPill } from "@/components/shared/status";
import { TriggerChip } from "@/components/shared/TriggerChip";
import { TRIGGER_LABEL, triggerKind } from "@/components/shared/trigger";

describe("triggerKind", () => {
  it("maps an execution's trigger.type and a graph's trigger node type onto the same kind", () => {
    expect(triggerKind("form")).toBe("form");
    expect(triggerKind("form.trigger")).toBe("form");
    expect(triggerKind("telegram")).toBe("telegram");
    expect(triggerKind("telegram.message")).toBe("telegram");
    expect(triggerKind("stripe.event")).toBe("stripe");
    expect(triggerKind("schedule.trigger")).toBe("schedule");
    expect(triggerKind("manual")).toBe("manual");
    expect(triggerKind("webhook.trigger")).toBe("webhook");
  });

  it("falls back to unknown rather than throwing", () => {
    expect(triggerKind(undefined)).toBe("unknown");
    expect(triggerKind(null)).toBe("unknown");
    expect(triggerKind("")).toBe("unknown");
    expect(triggerKind("something.else")).toBe("unknown");
    expect(TRIGGER_LABEL.unknown).toBe("Trigger");
  });
});

describe("status pills", () => {
  it("labels every run status and pulses only while running", () => {
    const running = renderToStaticMarkup(<RunStatusPill status="running" />);
    expect(running).toContain("Running");
    expect(running).toContain("animate-pulse");

    const failed = renderToStaticMarkup(<RunStatusPill status="failed" />);
    expect(failed).toContain("Failed");
    expect(failed).not.toContain("animate-pulse");

    expect(renderToStaticMarkup(<RunStatusPill status="waiting" label="Waiting for approval" />)).toContain(
      "Waiting for approval",
    );
  });

  it("shows a workflow as Published when active", () => {
    expect(renderToStaticMarkup(<WorkflowStatusPill status="active" />)).toContain("Published");
    expect(renderToStaticMarkup(<WorkflowStatusPill status="paused" />)).toContain("Paused");
    expect(renderToStaticMarkup(<WorkflowStatusPill status="draft" />)).toContain("Draft");
  });

  it("survives an unknown status", () => {
    expect(renderToStaticMarkup(<RunStatusPill status="mystery" />)).toContain("Queued");
    expect(renderToStaticMarkup(<RunStatusDot status="completed" title="2 minutes ago" />)).toContain(
      'aria-label="2 minutes ago"',
    );
  });
});

describe("TriggerChip", () => {
  it("renders the label, or keeps it for screen readers only", () => {
    expect(renderToStaticMarkup(<TriggerChip type="schedule" />)).toContain("Schedule");
    const iconOnly = renderToStaticMarkup(<TriggerChip type="webhook.trigger" showLabel={false} />);
    expect(iconOnly).toContain("sr-only");
    expect(iconOnly).toContain("Webhook");
  });
});
