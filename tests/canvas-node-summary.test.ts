import { describe, expect, it } from "vitest";

import { CATEGORY_TINT, categoryTint, nodeSummary } from "@/components/canvas/node-summary";
import { CATEGORIES } from "@/nodes/categories";
import { OPERATOR_LABELS } from "@/nodes/logic/condition";

/**
 * The one line under a node's name. Every case here is a node type someone will actually drop on
 * the canvas, because the point of the summary is that a graph reads without opening anything: a
 * wrong or missing line is worse than no line, so an unconfigured node says nothing at all.
 */
describe("nodeSummary", () => {
  it("says what an HTTP request will call", () => {
    expect(nodeSummary("http.request", { method: "POST", url: "https://api.stripe.com/v1/charges" })).toBe(
      "POST https://api.stripe.com/v1/charges",
    );
    // No method saved yet: the schema's default is what the run would use.
    expect(nodeSummary("http.request", { url: "https://example.com" })).toBe("GET https://example.com");
  });

  it("truncates a long URL rather than widening the card", () => {
    const summary = nodeSummary("http.request", {
      method: "GET",
      url: "https://api.example.com/v1/organisations/42/workflows/7/executions",
    });
    expect(summary?.startsWith("GET https://api.example.com/")).toBe(true);
    expect(summary?.endsWith("…")).toBe(true);
    // "GET " plus 40 characters of URL, at most.
    expect(summary?.length).toBeLessThanOrEqual(44);
  });

  it("reads a schedule in the mode it is configured in", () => {
    expect(nodeSummary("schedule.trigger", { mode: "every", everyMinutes: 5 })).toBe("Every 5 min");
    expect(nodeSummary("schedule.trigger", { mode: "every", everyMinutes: 120 })).toBe("Every 2 h");
    expect(nodeSummary("schedule.trigger", { mode: "cron", cron: "0 8 * * 1-5" })).toBe("Cron 0 8 * * 1-5");
    // A cron schedule with no expression is not a schedule yet.
    expect(nodeSummary("schedule.trigger", { mode: "cron" })).toBeNull();
  });

  it("reads a condition as the sentence its form makes", () => {
    expect(
      nodeSummary("logic.condition", {
        left: "{{ form_1.priority }}",
        operator: "equals",
        right: "urgent",
      }),
    ).toBe(`{{ form_1.priority }} ${OPERATOR_LABELS.equals} urgent`);
  });

  it("drops the right-hand side of a comparison that has none", () => {
    expect(nodeSummary("logic.condition", { left: "{{ a.b }}", operator: "isEmpty", right: "x" })).toBe(
      `{{ a.b }} ${OPERATOR_LABELS.isEmpty}`,
    );
  });

  it("counts the branches of a Switch and the rows of Set and Form", () => {
    expect(nodeSummary("logic.switch", { cases: ["pro", "team", "free"] })).toBe("3 cases");
    expect(nodeSummary("logic.switch", { cases: ["pro"] })).toBe("1 case");
    expect(nodeSummary("logic.set", { fields: [{ key: "a", value: 1 }] })).toBe("1 value");
    expect(
      nodeSummary("form.trigger", { fields: [{ name: "email" }, { name: "message" }] }),
    ).toBe("2 fields");
  });

  it("names the list a Loop walks and how long a Wait holds", () => {
    expect(nodeSummary("logic.loop", { items: "{{ http_1.body.items }}" })).toBe(
      "Over {{ http_1.body.items }}",
    );
    expect(nodeSummary("logic.wait", { mode: "duration", seconds: 300 })).toBe("Pause 5 min");
    expect(nodeSummary("logic.wait", { mode: "duration", seconds: 45 })).toBe("Pause 45s");
    expect(nodeSummary("logic.wait", { mode: "until", until: "2026-09-04T09:00:00Z" })).toBe(
      "Until 2026-09-04T09:00:00Z",
    );
  });

  it("shows the model an AI node will call, or that nobody picked one", () => {
    for (const type of ["ai.llm", "ai.classify", "ai.extract", "ai.agent"]) {
      expect(nodeSummary(type, { model: "gpt-5-mini" })).toBe("gpt-5-mini");
      expect(nodeSummary(type, {})).toBe("Model not set");
    }
  });

  it("shows where a message is going", () => {
    expect(nodeSummary("email.send", { to: "ops@example.com" })).toBe("ops@example.com");
    expect(nodeSummary("slack.postMessage", { channel: "#alerts" })).toBe("#alerts");
    expect(nodeSummary("telegram.sendMessage", { chatId: "12345" })).toBe("12345");
    expect(nodeSummary("discord.postMessage", { channelId: "987" })).toBe("987");
  });

  it("says nothing about a node type it does not know", () => {
    expect(nodeSummary("nope.notANode", { url: "https://example.com" })).toBeNull();
  });

  it("survives missing, empty and wrongly typed inputs", () => {
    expect(nodeSummary("http.request", undefined)).toBeNull();
    expect(nodeSummary("http.request", null)).toBeNull();
    expect(nodeSummary("http.request", {})).toBeNull();
    expect(nodeSummary("email.send", { to: "   " })).toBeNull();
    expect(nodeSummary("logic.switch", { cases: "three" as unknown })).toBeNull();
    expect(nodeSummary("logic.wait", { mode: "duration", seconds: "30" as unknown })).toBeNull();
    expect(nodeSummary("schedule.trigger", { mode: "every", everyMinutes: Number.NaN })).toBeNull();
  });
});

describe("categoryTint", () => {
  it("tints every category the sidebar groups by", () => {
    for (const category of CATEGORIES) {
      expect(CATEGORY_TINT[category.id]).toBeTruthy();
      expect(categoryTint(category.id)).toBe(CATEGORY_TINT[category.id]);
    }
  });

  it("falls back to the neutral tint for a node the registry does not have", () => {
    expect(categoryTint(undefined)).toBe(CATEGORY_TINT.action);
  });
});
