import { describe, expect, it } from "vitest";
import { withTriggerSample } from "@/lib/engine-client";
import { describeError } from "@/workflows/steps/run-node";
import { z } from "zod";

const graph = (sample: unknown, nodeType = "manual.trigger") =>
  ({
    triggerId: "t",
    nodes: { t: { id: "t", data: { nodeType, key: "start", label: "Run it", inputs: { sample } } } },
    edges: [],
  }) as unknown as Parameters<typeof withTriggerSample>[1];

describe("withTriggerSample", () => {
  it("fills an empty manual payload from the trigger node's sample", () => {
    const out = withTriggerSample({ type: "manual", payload: {} }, graph('{ "items": [1, 2] }'));
    expect(out.payload).toEqual({ items: [1, 2] });
  });
  it("keeps whatever the caller typed", () => {
    const out = withTriggerSample({ type: "manual", payload: { a: 1 } }, graph('{ "items": [1] }'));
    expect(out.payload).toEqual({ a: 1 });
  });
  it("leaves the payload alone for other triggers, invalid or empty samples", () => {
    expect(withTriggerSample({ type: "webhook", payload: {} }, graph('{ "x": 1 }')).payload).toEqual({});
    expect(withTriggerSample({ type: "manual", payload: {} }, graph("not json")).payload).toEqual({});
    expect(withTriggerSample({ type: "manual", payload: {} }, graph("{}")).payload).toEqual({});
    expect(withTriggerSample({ type: "manual", payload: {} }, graph('{ "x": 1 }', "webhook.trigger")).payload).toEqual({});
  });
});

describe("describeError", () => {
  it("turns a zod failure into a sentence about the node's settings", () => {
    const result = z.object({ connectionId: z.string(), maxTokens: z.number() }).safeParse({});
    expect(result.success).toBe(false);
    const text = describeError(result.error, "Urgent or not");
    expect(text).toContain('"Urgent or not" is not set up yet');
    expect(text).toContain("Connection: choose a connection");
    expect(text).toContain("Max tokens:");
    expect(text).not.toContain("invalid_type");
  });
  it("passes other errors through", () => {
    expect(describeError(new Error("boom"), "X")).toBe("boom");
  });
});
