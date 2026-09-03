import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { PAPAFLOW_NODE_TYPE, type WorkflowNodeType } from "@/components/canvas/graph-io";
import { lastRunFor, type RunStepRow } from "@/components/canvas/last-run";
import {
  buildVariableGroups,
  variableEntryLabel,
  type VariableGroup,
} from "@/components/canvas/variables";
import { EACH_HANDLE } from "@/nodes/logic/loop";

function node(id: string, nodeType: string, key: string, label = key): WorkflowNodeType {
  return {
    id,
    type: PAPAFLOW_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { nodeType, key, label, inputs: {} },
  };
}

function edge(source: string, target: string, sourceHandle?: string): Edge {
  return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null };
}

function step(nodeId: string, output: unknown): RunStepRow {
  return { nodeId, status: "success", startedAt: 1_000, finishedAt: 1_100, output };
}

/** trigger → http → email, and the picker asked for on the email node at the end. */
const CHAIN = {
  nodes: [
    node("t", "manual.trigger", "manual_trigger_1", "When I click Run"),
    node("h", "http.request", "http_request_1", "Fetch order"),
    node("e", "email.send", "email_send_1", "Email me"),
  ],
  edges: [edge("t", "h"), edge("h", "e")],
};

function groupsFor(nodeId: string, steps: RunStepRow[], graph = CHAIN): VariableGroup[] {
  const { sources } = lastRunFor({ nodeId, ...graph, steps });
  return buildVariableGroups({ nodeId, ...graph, sources });
}

function paths(group: VariableGroup | undefined): string[] {
  return (group?.entries ?? []).map((entry) => entry.path);
}

describe("buildVariableGroups", () => {
  it("offers a node's declared output before it has ever run", () => {
    const [http] = groupsFor("e", []);
    expect(http.label).toBe("Fetch order · http_request_1");
    expect(http.ran).toBe(false);
    expect(paths(http)).toEqual([
      "http_request_1",
      "http_request_1.status",
      "http_request_1.headers",
      "http_request_1.body",
    ]);
    expect(http.entries.every((entry) => entry.preview === "")).toBe(true);
  });

  it("adds the paths only the last run can know, marked as observed", () => {
    const [http] = groupsFor("e", [
      step("h", { status: 200, headers: { etag: "W/1" }, body: { id: "ord_1", total: 12 } }),
    ]);

    expect(http.ran).toBe(true);
    expect(paths(http)).toEqual([
      "http_request_1",
      // The schema's own fields keep their declared order and type…
      "http_request_1.status",
      "http_request_1.headers",
      "http_request_1.body",
      // …and everything the run showed underneath `body: z.any()` follows.
      "http_request_1.headers.etag",
      "http_request_1.body.id",
      "http_request_1.body.total",
    ]);

    const byPath = new Map(http.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("http_request_1.status")).toMatchObject({
      type: "number",
      observed: false,
      preview: "200",
    });
    expect(byPath.get("http_request_1.body.id")).toMatchObject({
      type: "string",
      observed: true,
      preview: "ord_1",
    });
    // The root itself previews the whole output, so `{{ http_request_1 }}` is not a leap of faith.
    expect(byPath.get("http_request_1")).toMatchObject({ type: "object", preview: "{…}" });
  });

  it("keeps a schema field's declared type when the run also produced it", () => {
    const [http] = groupsFor("e", [step("h", { status: 200, headers: {}, body: null })]);
    const status = http.entries.find((entry) => entry.path === "http_request_1.status");
    expect(status).toMatchObject({ type: "number", observed: false, preview: "200" });
    // `body: null` is a value, not a missing one.
    expect(http.entries.find((entry) => entry.path === "http_request_1.body")?.preview).toBe("null");
  });

  it("puts the trigger payload last and describes it from the run", () => {
    const groups = groupsFor("e", [step("t", { order: { id: "ord_1" } })]);
    const trigger = groups.at(-1);
    expect(trigger?.key).toBe("trigger");
    expect(trigger?.label).toBe("Trigger payload");
    expect(paths(trigger)).toEqual(["trigger", "trigger.order", "trigger.order.id"]);
    expect(trigger?.entries.at(-1)).toMatchObject({ observed: true, preview: "ord_1" });
  });

  it("offers $item between the ancestors and the trigger, on a loop body only", () => {
    const graph = {
      nodes: [
        node("t", "manual.trigger", "manual_trigger_1"),
        node("l", "logic.loop", "logic_loop_1"),
        node("b", "logic.set", "set_1"),
      ],
      edges: [edge("t", "l"), edge("l", "b", EACH_HANDLE)],
    };

    expect(groupsFor("b", [], graph).map((group) => group.key)).toEqual([
      "logic_loop_1",
      "manual_trigger_1",
      "$item",
      "trigger",
    ]);
    // The Loop node itself is not on its own body.
    expect(groupsFor("l", [], graph).map((group) => group.key)).toEqual([
      "manual_trigger_1",
      "trigger",
    ]);
  });

  it("still offers the trigger to a node nothing is wired to", () => {
    const graph = {
      nodes: [...CHAIN.nodes, node("x", "logic.set", "set_1")],
      edges: CHAIN.edges,
    };
    expect(groupsFor("x", [], graph).map((group) => group.key)).toEqual(["trigger"]);
  });
});

describe("variableEntryLabel", () => {
  it("speaks the path, the type and the value beside it", () => {
    expect(
      variableEntryLabel({ path: "http_request_1.status", type: "number", observed: false, preview: "200" }),
    ).toBe("Insert {{ http_request_1.status }}, number, value 200");
  });

  it("says where a path that only exists in real data came from", () => {
    expect(
      variableEntryLabel({ path: "trigger.order.id", type: "string", observed: true, preview: "ord_1" }),
    ).toBe("Insert {{ trigger.order.id }}, string, value ord_1, from last run");
  });

  it("leaves the value out when there is not one yet", () => {
    expect(variableEntryLabel({ path: "$item", type: "any", observed: false, preview: "" })).toBe(
      "Insert {{ $item }}, any",
    );
  });
});
