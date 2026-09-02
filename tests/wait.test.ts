import { describe, expect, it } from "vitest";

import { ConnectorError, type RunContext } from "@/nodes/define";
import { waitForWebhookNode } from "@/nodes/logic/wait-for-webhook";
import { waitMs, waitNode } from "@/nodes/logic/wait";

/**
 * The two control nodes that suspend a run. Neither does I/O, so everything here is the pure
 * arithmetic (`waitMs`) plus the `control` contract the orchestrator reads: `runGraph` turns
 * `{ kind: "sleep", ms }` into `sleep(ms)` and `{ kind: "hook" }` into `createHook({ token })`.
 *
 * Every case goes through `inputs.parse()` the way `runNode` does, because the defaults are part of
 * the behaviour: a node dropped on the canvas and never configured must still wait 30 seconds.
 */
function ctx<I>(inputs: I): RunContext<I> {
  return { inputs, orgId: "org_test", executionId: "exec_test", nodeId: "node_test" };
}

/** `now` is fixed rather than `Date.now()`: an `until` test that drifts is a flaky test. */
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

function ms(raw: unknown, now = NOW): number {
  return waitMs(waitNode.inputs.parse(raw), now);
}

describe("logic.wait", () => {
  it("is a logic node with no credential and no feature gate", () => {
    expect(waitNode.type).toBe("logic.wait");
    expect(waitNode.name).toBe("Wait");
    expect(waitNode.category).toBe("logic");
    expect(waitNode.icon).toBe("Clock");
    expect(waitNode.credential).toBeNull();
    expect(waitNode.requiresFeature).toBeNull();
  });

  it("waits 30 seconds when nothing has been configured", () => {
    expect(waitNode.inputs.parse({})).toEqual({ mode: "duration", seconds: 30 });
    expect(ms({})).toBe(30_000);
  });

  it("turns seconds into milliseconds", () => {
    expect(ms({ seconds: 45 })).toBe(45_000);
    expect(ms({ seconds: 3_600 })).toBe(3_600_000);
  });

  it("never suspends for less than a second, and never for a fraction of one", () => {
    expect(ms({ seconds: 1 })).toBe(1_000);
    expect(ms({ seconds: 1.4 })).toBe(1_400);
    // The schema's floor is 1 second; the clamp is what protects a template that resolved smaller.
    expect(waitMs({ mode: "duration", seconds: 0.2 }, NOW)).toBe(1_000);
    expect(waitMs({ mode: "duration", seconds: -5 }, NOW)).toBe(1_000);
    expect(() => waitNode.inputs.parse({ seconds: 0 })).toThrow();
  });

  it("counts the milliseconds left until an ISO moment", () => {
    expect(ms({ mode: "until", until: "2026-09-02T12:05:00.000Z" })).toBe(300_000);
    // Offsets and a plain date are both valid ISO 8601, and both have to work.
    expect(ms({ mode: "until", until: "2026-09-02T14:05:00.000+02:00" })).toBe(300_000);
    expect(ms({ mode: "until", until: "2026-09-03" })).toBe(12 * 3_600_000);
  });

  it("does not wait at all for a moment that has already passed", () => {
    expect(ms({ mode: "until", until: "2026-09-02T11:59:59.000Z" })).toBe(0);
    expect(ms({ mode: "until", until: "2020-01-01T00:00:00.000Z" })).toBe(0);
    // Exactly now is not "the past", but it is not a wait either.
    expect(ms({ mode: "until", until: "2026-09-02T12:00:00.000Z" })).toBe(0);
  });

  it("refuses an unreadable or missing date with a 400, so the run fails instead of retrying", () => {
    for (const until of ["not-a-date", "31/12/2026", "", "   "]) {
      const error = (() => {
        try {
          ms({ mode: "until", until });
          return null;
        } catch (thrown) {
          return thrown;
        }
      })();

      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).status).toBe(400);
    }

    expect(() => ms({ mode: "until" })).toThrow(ConnectorError);
  });

  it("reports what it waited for and asks the orchestrator to sleep exactly that long", async () => {
    const inputs = waitNode.inputs.parse({ seconds: 90 });
    const output = await waitNode.run(ctx(inputs));

    expect(output).toEqual({ waitedMs: 90_000 });
    expect(waitNode.outputs.parse(output)).toEqual({ waitedMs: 90_000 });
    // `control` is recomputed from the stored output on every replay, so it must be a pure
    // function of it — the same row always produces the same sleep.
    expect(waitNode.control?.(output)).toEqual({ kind: "sleep", ms: 90_000 });
  });
});

describe("logic.waitForWebhook", () => {
  it("is a logic node whose configuration is the URL, not a form", () => {
    expect(waitForWebhookNode.type).toBe("logic.waitForWebhook");
    expect(waitForWebhookNode.name).toBe("Wait for webhook");
    expect(waitForWebhookNode.category).toBe("logic");
    expect(waitForWebhookNode.icon).toBe("Webhook");
    expect(waitForWebhookNode.credential).toBeNull();
    expect(waitForWebhookNode.requiresFeature).toBeNull();
    expect(waitForWebhookNode.inputs.parse({})).toEqual({});
  });

  it("always suspends on a hook, and answers with the empty delivery until it is resumed", async () => {
    const output = await waitForWebhookNode.run(ctx({}));

    expect(output).toEqual({ body: null, headers: {} });
    expect(waitForWebhookNode.control?.(output)).toEqual({ kind: "hook" });
  });

  it("accepts the payload the resume route sends as its output", () => {
    const resumed = { body: { ok: true }, headers: { "content-type": "application/json" } };
    expect(waitForWebhookNode.outputs.parse(resumed)).toEqual(resumed);
    // A raw-text body is as valid as a JSON one: `body` is `z.any()`.
    expect(waitForWebhookNode.outputs.parse({ body: "hello", headers: {} })).toEqual({
      body: "hello",
      headers: {},
    });
  });
});
