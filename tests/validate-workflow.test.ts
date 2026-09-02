import { describe, expect, it } from "vitest";

import { inputIssues, sourceHandlesFor, validateWorkflow } from "@/lib/validate-workflow";
import { NODES } from "@/nodes/registry";

/**
 * The question `validate_workflow` asks, against the real node registry.
 *
 * Everything here is a graph the Builder agent could plausibly have written, checked against the
 * same definitions the engine runs — which is the point of the module: the model finds out about a
 * dangling edge or a missing credential from a sentence, not from a failed run.
 */

type NodeSpec = {
  id: string;
  key?: string;
  type: string;
  inputs?: Record<string, unknown>;
};

type EdgeSpec = { from: string; to: string; handle?: string };

function graph(nodes: NodeSpec[], edges: EdgeSpec[] = []) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: "papaflow",
      position: { x: 0, y: 0 },
      data: {
        nodeType: node.type,
        key: node.key ?? node.id,
        label: node.type,
        inputs: node.inputs ?? {},
      },
    })),
    edges: edges.map((edge, index) => ({
      id: `e${index}`,
      source: edge.from,
      target: edge.to,
      ...(edge.handle ? { sourceHandle: edge.handle } : {}),
    })),
  };
}

const TRIGGER: NodeSpec = { id: "trigger", type: "manual.trigger", inputs: { sample: "{}" } };
const HTTP: NodeSpec = {
  id: "http",
  type: "http.request",
  inputs: { url: "https://example.com", method: "GET" },
};

/** Every message, joined — assertions read better against one string than against an array. */
function messages(result: ReturnType<typeof validateWorkflow>): string {
  return result.problems.map((problem) => problem.message).join(" | ");
}

describe("validateWorkflow", () => {
  it("passes a trigger wired to one configured node", () => {
    const result = validateWorkflow(graph([TRIGGER, HTTP], [{ from: "trigger", to: "http" }]));
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("refuses an empty workflow", () => {
    expect(messages(validateWorkflow(graph([])))).toContain("empty");
  });

  it("wants exactly one trigger", () => {
    const none = validateWorkflow(graph([HTTP]));
    expect(messages(none)).toContain("no trigger node");

    const two = validateWorkflow(
      graph(
        [TRIGGER, { id: "second", type: "webhook.trigger" }, HTTP],
        [{ from: "trigger", to: "http" }],
      ),
    );
    expect(messages(two)).toContain("2 trigger nodes");
  });

  it("names a node type the registry does not know", () => {
    const result = validateWorkflow(
      graph([TRIGGER, { id: "ghost", type: "slack.postMesage" }], [{ from: "trigger", to: "ghost" }]),
    );
    expect(messages(result)).toContain('unknown node type "slack.postMesage"');
  });

  it("reports a required input the node never got", () => {
    const result = validateWorkflow(
      graph([TRIGGER, { id: "http", type: "http.request" }], [{ from: "trigger", to: "http" }]),
    );
    expect(messages(result)).toContain("url is required");
  });

  it("accepts a {{ template }} where the schema wants another type", () => {
    // `headers` is a record and `url` is a URL; both are templates here, and both are correct
    // configuration — the engine resolves them before the node parses its input.
    const result = validateWorkflow(
      graph(
        [
          TRIGGER,
          {
            id: "http",
            type: "http.request",
            inputs: { url: "{{ trigger.endpoint }}", headers: "{{ trigger.headers }}" },
          },
        ],
        [{ from: "trigger", to: "http" }],
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("still refuses a value that is wrong and not a template", () => {
    const result = validateWorkflow(
      graph([TRIGGER, { id: "http", type: "http.request", inputs: { url: 42 } }], [
        { from: "trigger", to: "http" },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(messages(result)).toContain("url");
  });

  it("refuses an edge pointing at a node that is not there", () => {
    const result = validateWorkflow(
      graph([TRIGGER, HTTP], [{ from: "trigger", to: "http" }, { from: "http", to: "gone" }]),
    );
    expect(messages(result)).toContain("edge points at a node that is not in the workflow");
  });

  it("refuses a handle the source node does not declare", () => {
    const result = validateWorkflow(
      graph(
        [TRIGGER, { id: "cond", type: "logic.condition" }, HTTP],
        [
          { from: "trigger", to: "cond" },
          { from: "cond", to: "http", handle: "maybe" },
        ],
      ),
    );
    expect(messages(result)).toContain('has no "maybe" output');
    expect(messages(result)).toContain('"true"');
  });

  it("accepts the branch handles a Condition does declare", () => {
    const result = validateWorkflow(
      graph(
        [TRIGGER, { id: "cond", type: "logic.condition" }, HTTP, { id: "set", type: "logic.set" }],
        [
          { from: "trigger", to: "cond" },
          { from: "cond", to: "http", handle: "true" },
          { from: "cond", to: "set", handle: "false" },
        ],
      ),
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("uses a Switch's own case names as handles", () => {
    const switchNode: NodeSpec = {
      id: "sw",
      type: "logic.switch",
      inputs: { value: "{{ trigger.kind }}", cases: ["lead", "spam"] },
    };
    const good = validateWorkflow(
      graph([TRIGGER, switchNode, HTTP], [
        { from: "trigger", to: "sw" },
        { from: "sw", to: "http", handle: "lead" },
      ]),
    );
    expect(good.ok).toBe(true);

    const bad = validateWorkflow(
      graph([TRIGGER, switchNode, HTTP], [
        { from: "trigger", to: "sw" },
        { from: "sw", to: "http", handle: "customer" },
      ]),
    );
    expect(messages(bad)).toContain('has no "customer" output');
  });

  it("reports a non-trigger node nothing is wired into", () => {
    const result = validateWorkflow(graph([TRIGGER, HTTP]));
    expect(messages(result)).toContain("nothing wired into it");
  });

  it("reports a node whose credential is required and missing", () => {
    const result = validateWorkflow(
      graph(
        [TRIGGER, { id: "slack", type: "slack.postMessage", inputs: { channel: "#general", text: "hi" } }],
        [{ from: "trigger", to: "slack" }],
      ),
      { features: ["pro_connectors"] },
    );
    expect(messages(result)).toContain("needs a slack connection");
  });

  it("accepts that node once it has a connection", () => {
    const result = validateWorkflow(
      graph(
        [
          TRIGGER,
          {
            id: "slack",
            type: "slack.postMessage",
            inputs: { connectionId: "conn_1", channel: "#general", text: "hi" },
          },
        ],
        [{ from: "trigger", to: "slack" }],
      ),
      { features: ["pro_connectors"] },
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("does not ask for a connection a node treats as optional", () => {
    // `email.send` sends from PapaFlow's own address without one (`credentialOptional`).
    expect(NODES["email.send"].credentialOptional).toBe(true);
    const result = validateWorkflow(
      graph(
        [
          TRIGGER,
          {
            id: "email",
            type: "email.send",
            inputs: { to: "someone@example.com", subject: "Hi", text: "There" },
          },
        ],
        [{ from: "trigger", to: "email" }],
      ),
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("reports a node the organisation's plan cannot run, when features are given", () => {
    const withoutPro = validateWorkflow(
      graph(
        [
          TRIGGER,
          {
            id: "slack",
            type: "slack.postMessage",
            inputs: { connectionId: "conn_1", channel: "#general", text: "hi" },
          },
        ],
        [{ from: "trigger", to: "slack" }],
      ),
      { features: ["core_connectors"] },
    );
    expect(messages(withoutPro)).toContain("pro_connectors");
  });

  it("survives a graph of nonsense without throwing", () => {
    const result = validateWorkflow({
      nodes: [null, 42, { id: "x" }, { data: { nodeType: "http.request" } }],
      edges: ["nope", { id: "e", source: "x" }],
    } as unknown as { nodes?: unknown; edges?: unknown });
    expect(result.ok).toBe(false);
  });

  it("treats a missing graph as an empty one", () => {
    expect(validateWorkflow(undefined).ok).toBe(false);
    expect(validateWorkflow(null).ok).toBe(false);
  });
});

describe("inputIssues", () => {
  it("allows a half-configured node while the Builder is still placing it", () => {
    const definition = NODES["slack.postMessage"];
    expect(inputIssues(definition, {}, { allowMissing: true })).toEqual([]);
    expect(inputIssues(definition, {}).length).toBeGreaterThan(0);
  });

  it("refuses a wrong type even in the lenient mode", () => {
    const issues = inputIssues(NODES["slack.postMessage"], { channel: 7 }, { allowMissing: true });
    expect(issues.map((issue) => issue.path)).toEqual(["channel"]);
  });

  it("names every missing field so a tool can report what is left", () => {
    const issues = inputIssues(NODES["slack.postMessage"], { connectionId: "conn_1" });
    expect(issues.map((issue) => issue.path).sort()).toEqual(["channel", "text"]);
  });
});

describe("sourceHandlesFor", () => {
  it("defaults to the single out handle", () => {
    expect(sourceHandlesFor(NODES["http.request"], {})).toEqual(["out"]);
  });

  it("reads a Switch's handles off its half-typed configuration", () => {
    expect(sourceHandlesFor(NODES["logic.switch"], { value: "x", cases: ["a", "b"] })).toEqual([
      "a",
      "b",
      "default",
    ]);
  });

  it("never throws on a half-typed configuration, whatever the node does with it", () => {
    // `handles()` is node code reading inputs the schema refused, so it is called defensively:
    // the canvas draws whatever it returns and `validateWorkflow` compares edges against it.
    expect(() => sourceHandlesFor(NODES["logic.switch"], { cases: "nope" })).not.toThrow();
    expect(sourceHandlesFor(NODES["logic.switch"], {})).toContain("default");
  });
});
