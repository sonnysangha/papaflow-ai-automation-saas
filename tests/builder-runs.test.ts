import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Builder's read-and-debug half: the graph as the model sees it, a run as the model reads it,
 * the picker lists that stop it inventing column names, and the round trip that starts a run.
 *
 * Convex, Clerk and the app's run route are all replaced. What is under test is what the tools
 * *decide* — which nodes are ends, what a step summary says, what gets truncated, whose connection
 * this is — none of which needs a deployment.
 *
 * Kept apart from `builder-tools.test.ts` because these tests mock `@/lib/builder-engine` and
 * `@/lib/connections-engine` for the whole file, and that file's job is the opposite: the real
 * catalogue and the real schemas.
 */
const { orgPlanFromClerk } = vi.hoisted(() => ({ orgPlanFromClerk: vi.fn() }));
vi.mock("@/lib/billing-engine", () => ({ orgPlanFromClerk }));

const engine = vi.hoisted(() => ({
  getBuilderWorkflow: vi.fn(),
  listBuilderRuns: vi.fn(),
  getBuilderRun: vi.fn(),
  updateBuilderNode: vi.fn(),
  renameBuilderWorkflow: vi.fn(),
  configureBuilderNode: vi.fn(),
  addBuilderNode: vi.fn(),
  connectBuilderNodes: vi.fn(),
  removeBuilderNode: vi.fn(),
}));
vi.mock("@/lib/builder-engine", () => ({
  ...engine,
  builderErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

const connections = vi.hoisted(() => ({
  listOrgConnections: vi.fn(),
  openOrgConnection: vi.fn(),
}));
vi.mock("@/lib/connections-engine", () => connections);

const { describeWorkflow, finish, setTriggerSample, updateNode } = await import(
  "@/agents/builder/lib/edits"
);
const { listRuns, runReport, startManualRun, summariseRun, summariseSteps, trimValue, waitForRun } =
  await import("@/agents/builder/lib/runs");
type BuilderRun = import("@/lib/builder-engine").BuilderRun;
type BuilderRunStep = import("@/lib/builder-engine").BuilderRunStep;
const { modelOptions, pickOptions } = await import("@/agents/builder/lib/pickers");

const getWorkflow = (await import("@/agents/builder/tools/get_workflow")).default;
const getRunTool = (await import("@/agents/builder/tools/get_run")).default;
const listRunsTool = (await import("@/agents/builder/tools/list_runs")).default;
const listPickerOptions = (await import("@/agents/builder/tools/list_picker_options")).default;
const runWorkflow = (await import("@/agents/builder/tools/run_workflow")).default;
const finishTool = (await import("@/agents/builder/tools/finish")).default;

const SESSION = {
  orgId: "org_1",
  userId: "user_1",
  workflowId: "wf_1",
  tokenPlan: "pro",
  plan: "pro",
  features: ["ai_builder", "pro_connectors", "core_connectors"],
};

/** A session as `agents/builder/channels/eve.ts` projects it from a verified Clerk token. */
function ctx(attributes: Record<string, string> | null = SIGNED_IN) {
  return { session: { auth: { current: attributes === null ? null : { attributes } } } };
}

/**
 * A tool's `execute`, minus eve's full `ToolContext` — these tools read nothing but
 * `session.auth.current.attributes`, and building a sandbox-bearing context to prove it would test
 * eve rather than the Builder.
 */
type CallableTool = { execute: (input: never, ctx: never) => Promise<unknown> };
function call(tool: unknown, input: unknown, context: unknown = ctx()): Promise<unknown> {
  return (tool as CallableTool).execute(input as never, context as never);
}

const SIGNED_IN = { orgId: "org_1", userId: "user_1", workflowId: "wf_1", plan: "pro" };

function node(
  id: string,
  key: string,
  nodeType: string,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    id,
    type: "papaflow",
    position: { x: 80, y: 160 },
    data: { nodeType, key, label: key, inputs: {}, ...extra },
  };
}

/** A trigger, a Condition and two leaves — the shape "add a step after the end nodes" needs. */
function graph() {
  return {
    name: "Flow",
    status: "draft" as const,
    version: 4,
    graph: {
      triggerId: "n1",
      nodes: [
        node("n1", "manual_trigger_1", "manual.trigger", { inputs: { sample: '{"name":"Sam"}' } }),
        node("n2", "cond_1", "logic.condition", {
          inputs: { left: "{{ trigger.name }}", operator: "eq", right: "Sam" },
        }),
        node("n3", "set_1", "data.set"),
        node("n4", "set_2", "data.set"),
        node("n5", "orphan_1", "data.set"),
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3", sourceHandle: "true" },
        { id: "e3", source: "n2", target: "n4", sourceHandle: "false" },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  orgPlanFromClerk.mockResolvedValue("pro");
  engine.getBuilderWorkflow.mockResolvedValue(graph());
  process.env.APP_ORIGIN = "https://app.test";
  process.env.ENGINE_SECRET = "engine-secret";
});

/* -------------------------------------------------------------------------------------------------
 * get_workflow.
 * ---------------------------------------------------------------------------------------------- */

describe("describeWorkflow", () => {
  it("names every node by its template key and reports the handles it offers", async () => {
    const view = await describeWorkflow(SESSION);

    expect(view).toMatchObject({ name: "Flow", status: "draft", version: 4 });
    expect(view.trigger).toEqual({ node: "manual_trigger_1", type: "manual.trigger" });
    expect(view.nodes.map((entry) => entry.node)).toEqual([
      "manual_trigger_1",
      "cond_1",
      "set_1",
      "set_2",
      "orphan_1",
    ]);
    expect(view.nodes.find((entry) => entry.node === "cond_1")?.handles).toEqual(["true", "false"]);
    expect(view.nodes.find((entry) => entry.node === "manual_trigger_1")?.isTrigger).toBe(true);
  });

  it("keeps templates exactly as they are stored, so the model can read what it wrote", async () => {
    const view = await describeWorkflow(SESSION);
    expect(view.nodes.find((entry) => entry.node === "cond_1")?.inputs).toMatchObject({
      left: "{{ trigger.name }}",
    });
  });

  it("answers the question the Builder used to ask the user: which nodes are the end nodes", async () => {
    const view = await describeWorkflow(SESSION);
    expect(view.endNodes).toEqual(["set_1", "set_2", "orphan_1"]);
    expect(view.orphanNodes).toEqual(["orphan_1"]);
  });

  it("describes edges in keys and names the handle each one leaves by", async () => {
    const view = await describeWorkflow(SESSION);
    expect(view.edges).toEqual([
      { from: "manual_trigger_1", handle: "out", to: "cond_1" },
      { from: "cond_1", handle: "true", to: "set_1" },
      { from: "cond_1", handle: "false", to: "set_2" },
    ]);
  });

  it("refuses a workflow that is not this organisation's", async () => {
    engine.getBuilderWorkflow.mockResolvedValue(null);
    await expect(describeWorkflow(SESSION)).rejects.toThrow(/another organisation/);
  });
});

/* -------------------------------------------------------------------------------------------------
 * update_node and set_trigger_sample.
 * ---------------------------------------------------------------------------------------------- */

describe("update_node and set_trigger_sample", () => {
  it("moves a node without touching its configuration", async () => {
    engine.updateBuilderNode.mockResolvedValue({ nodeId: "n3", key: "set_1", version: 5 });

    const result = await updateNode(SESSION, { node: "set_1", position: { x: 640, y: 320 } });

    expect(engine.updateBuilderNode).toHaveBeenCalledWith(
      { workflowId: "wf_1", orgId: "org_1", userId: "user_1" },
      { node: "set_1", position: { x: 640, y: 320 } },
    );
    expect(result).toMatchObject({ updated: "set_1", position: { x: 640, y: 320 }, version: 5 });
  });

  it("refuses a node that is not in the graph before it writes anything", async () => {
    await expect(updateNode(SESSION, { node: "nope", label: "x" })).rejects.toThrow(
      /no node "nope"/,
    );
    expect(engine.updateBuilderNode).not.toHaveBeenCalled();
  });

  it("stores the trigger sample as the Manual trigger's own JSON and reports its keys", async () => {
    engine.configureBuilderNode.mockResolvedValue({ nodeId: "n1", key: "manual_trigger_1", inputs: {}, version: 5 });

    const result = await setTriggerSample(SESSION, { name: "Sam", email: "sam@example.com" });

    expect(engine.configureBuilderNode).toHaveBeenCalledWith(expect.anything(), {
      node: "n1",
      inputs: { sample: JSON.stringify({ name: "Sam", email: "sam@example.com" }, null, 2) },
    });
    expect(result.triggerKeys).toEqual(["name", "email"]);
  });

  it("says so when the workflow does not start with a Manual trigger", async () => {
    const withoutManual = graph();
    withoutManual.graph.nodes[0] = node("n1", "webhook_trigger_1", "webhook.trigger");
    engine.getBuilderWorkflow.mockResolvedValue(withoutManual);

    await expect(setTriggerSample(SESSION, { a: 1 })).rejects.toThrow(/Manual trigger/);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Reading runs.
 * ---------------------------------------------------------------------------------------------- */

/** Convex brands its ids; the summarisers only ever read them as strings. */
function id<T>(value: string): T {
  return value as T;
}

const RUN: BuilderRun = {
  executionId: id("exec_1"),
  status: "failed" as const,
  triggerType: "manual",
  workflowVersion: 4,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_002_500,
  error: "airtable_create_record_1: Every field was empty",
};

function step(overrides: Partial<BuilderRunStep> = {}): BuilderRunStep {
  return {
    stepId: id("step_1"),
    nodeId: "n2",
    nodeType: "logic.condition",
    status: "success" as const,
    attempt: 1,
    startedAt: 1_700_000_000_100,
    finishedAt: 1_700_000_000_400,
    ...overrides,
  };
}

describe("summarising a run", () => {
  it("turns a run row into one readable line", () => {
    expect(summariseRun(RUN)).toEqual({
      runId: "exec_1",
      status: "failed",
      trigger: "manual",
      startedAt: new Date(RUN.startedAt).toISOString(),
      durationMs: 2500,
      error: RUN.error,
      workflowVersion: 4,
    });
  });

  it("leaves the duration off a run that has not finished", () => {
    expect(summariseRun({ ...RUN, finishedAt: undefined }).durationMs).toBeUndefined();
  });

  it("orders steps as they ran and names each one by its node key", () => {
    const steps = summariseSteps(
      [
        step({ stepId: id("s2"), nodeId: "n3", startedAt: 200 }),
        step({ stepId: id("s1"), nodeId: "n1", startedAt: 100 }),
      ],
      { n1: { key: "manual_trigger_1", label: "Start" }, n3: { key: "set_1", label: "Set" } },
    );
    expect(steps.map((entry) => entry.node)).toEqual(["manual_trigger_1", "set_1"]);
    expect(steps[0].label).toBe("Start");
  });

  it("numbers loop passes from one and names a child row's parent", () => {
    const steps = summariseSteps(
      [
        step({ stepId: id("parent"), nodeId: "n9", nodeType: "ai.agent", startedAt: 100 }),
        step({
          stepId: id("child"),
          nodeId: "n9",
          nodeType: "tool",
          parentStepId: id("parent"),
          startedAt: 150,
        }),
        step({ stepId: id("pass2"), nodeId: "n3", iteration: 1, startedAt: 200 }),
      ],
      { n9: { key: "agent_1", label: "Agent" }, n3: { key: "set_1", label: "Set" } },
    );

    expect(steps[1].childOf).toBe("agent_1");
    expect(steps[2].loopPass).toBe(2);
    expect(steps[0].loopPass).toBeUndefined();
  });

  it("carries the template warnings, which is the whole point of reading a run", () => {
    const [summary] = summariseSteps(
      [step({ warnings: ["{{ trigger.name }}: not found"], status: "success" })],
      {},
    );
    expect(summary.warnings).toEqual(["{{ trigger.name }}: not found"]);
    // A step with none does not carry an empty array into the model's context.
    expect(summariseSteps([step({ warnings: [] })], {})[0].warnings).toBeUndefined();
  });
});

describe("trimValue", () => {
  it("returns a small value as itself, so the model can read a real path", () => {
    expect(trimValue({ body: { id: 7 } })).toEqual({ body: { id: 7 } });
    expect(trimValue(undefined)).toBeUndefined();
  });

  it("cuts a large value and says so rather than handing back broken JSON", () => {
    const trimmed = trimValue({ html: "x".repeat(5000) }, 200);
    expect(typeof trimmed).toBe("string");
    expect(String(trimmed)).toMatch(/…truncated \(\d+ characters in full\)$/);
    expect(String(trimmed).length).toBeLessThan(300);
  });

  it("redacts a secret-looking key defensively, even though the engine redacted first", () => {
    expect(trimValue({ headers: { authorization: "Bearer abc", accept: "json" } })).toEqual({
      headers: { authorization: "••••", accept: "json" },
    });
    expect(trimValue({ apiKey: "sk-live-123" })).toEqual({ apiKey: "••••" });
  });
});

describe("the run tools", () => {
  it("lists runs newest first through the engine, scoped to this workflow", async () => {
    engine.listBuilderRuns.mockResolvedValue([RUN]);

    expect(await listRuns(SESSION, 3)).toEqual([summariseRun(RUN)]);
    expect(engine.listBuilderRuns).toHaveBeenCalledWith("wf_1", "org_1", 3);
  });

  it("joins a run's steps to the graph's node names", async () => {
    engine.getBuilderRun.mockResolvedValue({
      execution: RUN,
      steps: [step({ nodeId: "n2", warnings: ["{{ trigger.name }}: not found"] })],
    });

    const report = await runReport(SESSION, "exec_1");
    expect(report).toMatchObject({ runId: "exec_1", status: "failed", stillRunning: false });
    expect(report?.steps[0]).toMatchObject({ node: "cond_1", warnings: ["{{ trigger.name }}: not found"] });
    expect(engine.getBuilderRun).toHaveBeenCalledWith({
      executionId: "exec_1",
      workflowId: "wf_1",
      orgId: "org_1",
    });
  });

  it("answers null for a run id that is not this workflow's", async () => {
    engine.getBuilderRun.mockResolvedValue(null);
    expect(await runReport(SESSION, "exec_other")).toBeNull();
    await expect(call(getRunTool, { runId: "exec_other" })).rejects.toThrow(/no run/);
  });

  it("polls until the run settles, then stops", async () => {
    engine.getBuilderRun
      .mockResolvedValueOnce({ execution: { ...RUN, status: "running" }, steps: [] })
      .mockResolvedValueOnce({ execution: { ...RUN, status: "running" }, steps: [] })
      .mockResolvedValue({ execution: { ...RUN, status: "completed" }, steps: [] });

    const report = await waitForRun(SESSION, "exec_1", 30, async () => {});

    expect(report?.status).toBe("completed");
    expect(engine.getBuilderRun).toHaveBeenCalledTimes(3);
  });

  it("stops waiting on a run parked on a hook — an Approval will not move on its own", async () => {
    engine.getBuilderRun.mockResolvedValue({ execution: { ...RUN, status: "waiting" }, steps: [] });

    const report = await waitForRun(SESSION, "exec_1", 30, async () => {});
    expect(report?.status).toBe("waiting");
    expect(engine.getBuilderRun).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Knocking on the Next app: starting a run, and publishing.
 *
 * Both go through `agents/builder/lib/engine-route.ts`, because both need something that only
 * exists inside the Next build — `start(runGraph, …)` for a run, and the durable scheduler run that
 * publishing a Schedule trigger starts.
 * ---------------------------------------------------------------------------------------------- */

function stubAppRoute(response: { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("startManualRun", () => {
  it("asks the Next app to press Run, with the shared secret as a bearer token", async () => {
    const calls = stubAppRoute({ status: 200, body: { executionId: "exec_9", runId: "run_9" } });

    expect(await startManualRun(SESSION, { name: "Sam" })).toEqual({ runId: "exec_9" });
    expect(calls[0].url).toBe("https://app.test/api/engine/run");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer engine-secret",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      workflowId: "wf_1",
      orgId: "org_1",
      userId: "user_1",
      payload: { name: "Sam" },
    });
  });

  it("passes a 4xx back as a sentence the model can act on", async () => {
    stubAppRoute({ status: 400, body: { code: "run_failed", error: "run_limit" } });
    await expect(startManualRun(SESSION, undefined)).rejects.toThrow(/run_limit/);
  });

  it("treats a 401 or a 5xx as the deployment's problem, not the model's", async () => {
    stubAppRoute({ status: 401, body: { error: "Bad engine secret." } });
    await expect(startManualRun(SESSION, undefined)).rejects.toMatchObject({
      name: "EngineUnavailableError",
    });
  });

  it("refuses without APP_ORIGIN rather than fetching a relative URL", async () => {
    delete process.env.APP_ORIGIN;
    await expect(startManualRun(SESSION, undefined)).rejects.toMatchObject({
      name: "EngineUnavailableError",
    });
  });
});

/* -------------------------------------------------------------------------------------------------
 * Finishing, which is publishing.
 *
 * `finish` used to write the status through a Convex mutation, and a schedule-triggered workflow
 * the Builder built was live in the canvas and never fired, because nothing had started the
 * scheduler run. It now presses the same Publish the user presses, through
 * `POST /api/engine/publish` — so what is pinned here is the request it makes and what it does with
 * each kind of answer.
 * ---------------------------------------------------------------------------------------------- */

describe("finish", () => {
  const SUMMARY = "Checks the endpoint every hour and posts failures to Slack.";

  it("publishes through the app's own Publish, with the shared secret as a bearer token", async () => {
    const calls = stubAppRoute({
      status: 200,
      body: { status: "active", scheduled: true, nextAt: 1_700_000_000_000 },
    });

    const result = await finish(SESSION, SUMMARY);

    expect(calls[0].url).toBe("https://app.test/api/engine/publish");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer engine-secret",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      workflowId: "wf_1",
      orgId: "org_1",
      userId: "user_1",
      publish: true,
    });
    expect(result).toMatchObject({
      workflow: "Flow",
      status: "active",
      scheduled: true,
      summary: SUMMARY,
      trigger: "Manual trigger",
    });
  });

  it("reports a plan that refuses the interval as something the model can fix", async () => {
    stubAppRoute({
      status: 400,
      body: {
        code: "too_frequent",
        error:
          "Your plan runs a schedule at most once every 1 hour; this one would run every 2 min. " +
          "Upgrade, or slow the schedule down.",
      },
    });

    // The route's own sentence, plus the two ways out — the workflow is still unpublished, so
    // slowing the schedule down and calling finish again actually works.
    await expect(finish(SESSION, SUMMARY)).rejects.toThrow(/at most once every 1 hour/);
    await expect(finish(SESSION, SUMMARY)).rejects.toThrow(/configure_node/);
    await expect(finish(SESSION, SUMMARY)).rejects.toThrow(/still unpublished/);
  });

  it("passes on a refusal that is not the Schedule trigger's, as it came", async () => {
    stubAppRoute({ status: 404, body: { code: "not_found", error: "No such workflow." } });
    await expect(finish(SESSION, SUMMARY)).rejects.toThrow(/^No such workflow\.$/);
  });

  it("ends the turn on a 5xx instead of letting the model publish again", async () => {
    stubAppRoute({ status: 500, body: { code: "publish_failed", error: "Convex is down" } });

    expect(await call(finishTool, { summary: SUMMARY })).toMatchObject({
      ok: false,
      error: "service_unavailable",
      retryable: false,
    });
  });
});

/* -------------------------------------------------------------------------------------------------
 * Pickers.
 * ---------------------------------------------------------------------------------------------- */

describe("list_picker_options", () => {
  beforeEach(() => {
    connections.listOrgConnections.mockResolvedValue([
      { id: "conn_air", provider: "airtable", kind: "apiKey", label: "Base", status: "active" },
      { id: "conn_ai", provider: "openai", kind: "apiKey", label: "Key", status: "active" },
    ]);
  });

  it("refuses a connection that is not this organisation's before opening anything", async () => {
    await expect(
      pickOptions(SESSION, { connectionId: "conn_someone_else", kind: "bases" }),
    ).rejects.toThrow(/does not belong to this workspace/);
    expect(connections.openOrgConnection).not.toHaveBeenCalled();
  });

  it("hands back the connector's own list of remote objects", async () => {
    connections.openOrgConnection.mockResolvedValue({
      provider: "airtable",
      kind: "apiKey",
      secret: { apiKey: "pat_secret" },
      meta: {},
    });
    const airtable = await import("@/connectors/airtable");
    const spy = vi
      .spyOn(airtable.airtableConnector, "pick")
      .mockResolvedValue([{ id: "fldA", label: "Name", type: "singleLineText" }]);

    const result = await pickOptions(SESSION, { connectionId: "conn_air", kind: "fields:app1:tbl1" });

    expect(result).toEqual({
      provider: "airtable",
      kind: "fields:app1:tbl1",
      options: [{ id: "fldA", label: "Name", type: "singleLineText" }],
    });
    expect(spy).toHaveBeenCalledWith("fields:app1:tbl1", { apiKey: "pat_secret" }, {});
    spy.mockRestore();
  });

  it("answers the models picker from what the connector captured at connect time", async () => {
    connections.openOrgConnection.mockResolvedValue({
      provider: "openai",
      kind: "apiKey",
      secret: { apiKey: "sk-x" },
      meta: { models: ["gpt-5.6", "text-embedding-3-small", "gpt-4o-mini"] },
    });

    const result = await pickOptions(SESSION, { connectionId: "conn_ai", kind: "models" });
    // Sorted, and the embedding model is not something a text node can call.
    expect(result.options.map((option) => option.id)).toEqual(["gpt-4o-mini", "gpt-5.6"]);
  });

  it("filters and sorts a stored model list the same way the dropdown does", () => {
    expect(modelOptions({ models: ["b", "whisper-large", "a"] }).map((o) => o.id)).toEqual(["a", "b"]);
    expect(modelOptions(undefined)).toEqual([]);
    expect(modelOptions({ models: "not a list" })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * The plan gate, on every new tool.
 * ---------------------------------------------------------------------------------------------- */

describe("the plan gate on the new tools", () => {
  const calls: [string, unknown, unknown][] = [
    ["get_workflow", getWorkflow, {}],
    ["list_runs", listRunsTool, {}],
    ["get_run", getRunTool, { runId: "exec_1" }],
    ["list_picker_options", listPickerOptions, { connectionId: "conn_air", kind: "bases" }],
    ["run_workflow", runWorkflow, { wait: false }],
  ];

  it.each(calls)(
    "%s refuses an organisation whose plan does not include the Builder",
    async (_name, tool, input) => {
      orgPlanFromClerk.mockResolvedValue("free_org");
      await expect(call(tool, input)).rejects.toThrow(/Pro feature/);
    },
  );

  it.each(calls)(
    "%s refuses a session the panel did not bind to a workflow",
    async (_name, tool, input) => {
      await expect(
        call(tool, input, ctx({ orgId: "org_1", userId: "user_1" })),
      ).rejects.toThrow(/not bound to a workflow/);
    },
  );
});
