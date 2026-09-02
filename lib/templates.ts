// Starter workflows: five graphs a new organisation can open instead of an empty canvas.
//
// A template is nothing more than the JSON `workflows.graph` already holds, so creating one is an
// ordinary `workflows.create({ name, graph })` and nothing downstream — the engine, the validator,
// the Builder agent — can tell a template apart from a graph somebody drew by hand. That is the
// point: a template is a head start, not a mode.
//
// Every node type below is in `nodes/registry.ts` and every configuration parses against that
// node's own zod schema, with one deliberate exception: **a field only the reader can fill in is
// left blank.** A template cannot know which Telegram chat is yours or which AI key you connected,
// so those nodes are shipped unconfigured and `templateSetup()` names them — on the card before you
// pick it, and in the validator's problem list after. `tests/workflow-templates.test.ts` holds the
// line: a template may leave setup on the nodes it declares, and nothing else.
//
// React-free and Convex-free so the picker, the canvas and the test all read the same table.

import { NODES } from "@/nodes/registry";

/** The React Flow node type every canvas node carries; mirrors `PAPAFLOW_NODE_TYPE`. */
const PAPAFLOW_NODE_TYPE = "papaflow";

export type TemplateNode = {
  id: string;
  type: typeof PAPAFLOW_NODE_TYPE;
  position: { x: number; y: number };
  data: {
    nodeType: string;
    /** The name templates address this node by — chosen for reading, not generated. */
    key: string;
    label: string;
    inputs: Record<string, unknown>;
  };
};

export type TemplateEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};

export type TemplateGraph = {
  nodes: TemplateNode[];
  edges: TemplateEdge[];
  triggerId?: string;
};

export type WorkflowTemplate = {
  /** Stable slug; the picker uses it as a React key and the create call quotes it in analytics. */
  id: string;
  name: string;
  description: string;
  /** One word for the shelf it sits on in the picker. */
  category: string;
  graph: TemplateGraph;
  /**
   * The Clerk feature slug this graph needs, when one of its nodes is plan-gated. Derived from the
   * registry rather than written down, so a template can never claim to be free after the node it
   * uses becomes a Pro connector.
   */
  requiresFeature?: string;
};

/** Grid the graphs are laid out on, so every template opens looking like the same product. */
const COLUMN = 300;
const ROW = 150;

function node(
  key: string,
  nodeType: string,
  label: string,
  column: number,
  row: number,
  inputs: Record<string, unknown> = {},
): TemplateNode {
  return {
    id: key,
    type: PAPAFLOW_NODE_TYPE,
    position: { x: column * COLUMN, y: row * ROW },
    data: { nodeType, key, label, inputs },
  };
}

function edge(source: string, target: string, sourceHandle?: string): TemplateEdge {
  return {
    id: `${source}-${sourceHandle ?? "out"}-${target}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

/** The first trigger on the canvas is the one the engine starts from — same rule as `toStoredGraph`. */
function graph(nodes: TemplateNode[], edges: TemplateEdge[]): TemplateGraph {
  const trigger = nodes.find((entry) => NODES[entry.data.nodeType]?.category === "trigger");
  return { nodes, edges, ...(trigger ? { triggerId: trigger.id } : {}) };
}

const leadIntake: TemplateGraph = graph(
  [
    node("form", "form.trigger", "Enquiry form", 0, 1, {
      title: "How can we help?",
      description: "Tell us what you need and we will come back to you.",
      fields: [
        { name: "email", label: "Email", type: "email", required: true },
        { name: "message", label: "What do you need?", type: "textarea", required: true },
      ],
      submitLabel: "Send",
    }),
    // `connectionId` and `model` are yours to choose: which AI account, and which of its models.
    node("classify", "ai.classify", "Urgent or not", 1, 1, {
      model: "",
      text: "{{ form.values.message }}",
      labels: ["urgent", "normal"],
      instructions: "Answer urgent only when the sender needs a reply today.",
    }),
    node("is_urgent", "logic.condition", "Urgent?", 2, 1, {
      left: "{{ classify.label }}",
      operator: "equals",
      right: "urgent",
    }),
    node("ping_team", "telegram.sendMessage", "Ping the team", 3, 0, {
      chatId: "",
      text: "Urgent enquiry from {{ form.values.email }}:\n{{ form.values.message }}",
      parseMode: "none",
    }),
    node("acknowledge", "email.send", "Send a holding reply", 3, 2, {
      to: "{{ form.values.email }}",
      subject: "Thanks — we have your message",
      text: "Thanks for getting in touch. Someone will reply shortly.",
    }),
  ],
  [
    edge("form", "classify"),
    edge("classify", "is_urgent"),
    edge("is_urgent", "ping_team", "true"),
    edge("is_urgent", "acknowledge", "false"),
  ],
);

const webhookRelay: TemplateGraph = graph(
  [
    node("hook", "webhook.trigger", "Incoming webhook", 0, 0),
    node("call", "http.request", "Call the API", 1, 0, {
      method: "POST",
      url: "https://httpbin.org/post",
      auth: "none",
      headers: { "content-type": "application/json" },
      body: '{ "method": "{{ hook.method }}" }',
    }),
    node("result", "logic.set", "Shape the result", 2, 0, {
      fields: [
        { key: "status", value: "{{ call.status }}" },
        { key: "body", value: "{{ call.body }}" },
      ],
    }),
  ],
  [edge("hook", "call"), edge("call", "result")],
);

const hourlyCheck: TemplateGraph = graph(
  [
    node("every_hour", "schedule.trigger", "Every hour", 0, 0, {
      mode: "every",
      everyMinutes: 60,
    }),
    node("check", "http.request", "Check the endpoint", 1, 0, {
      method: "GET",
      url: "https://httpbin.org/get",
      auth: "none",
    }),
    node("report", "email.send", "Email the result", 2, 0, {
      to: "you@example.com",
      subject: "Hourly check: {{ check.status }}",
      text: "The endpoint answered {{ check.status }}.",
    }),
  ],
  [edge("every_hour", "check"), edge("check", "report")],
);

const approvalGate: TemplateGraph = graph(
  [
    node("start", "manual.trigger", "Run it", 0, 1, {
      sample: '{ "vendor": "Acme", "amount": 4200 }',
    }),
    // `connectionId` and `target` are yours: which chat app to ask in, and where.
    node("ask", "logic.approval", "Ask for sign-off", 1, 1, {
      message: "Approve {{ start.amount }} for {{ start.vendor }}?",
      approveLabel: "Approve",
      rejectLabel: "Reject",
    }),
    node("decision", "logic.condition", "Approved?", 2, 1, {
      left: "{{ ask.approved }}",
      operator: "equals",
      right: "true",
    }),
    node("record", "logic.set", "Record the approval", 3, 0, {
      fields: [
        { key: "vendor", value: "{{ start.vendor }}" },
        { key: "approvedBy", value: "{{ ask.by }}" },
      ],
    }),
    node("decline", "logic.set", "Record the refusal", 3, 2, {
      fields: [
        { key: "vendor", value: "{{ start.vendor }}" },
        { key: "declinedBy", value: "{{ ask.by }}" },
      ],
    }),
  ],
  [
    edge("start", "ask"),
    // Both answers meet at the same Condition, so the run reads the decision in one place.
    edge("ask", "decision", "approved"),
    edge("ask", "decision", "rejected"),
    edge("decision", "record", "true"),
    edge("decision", "decline", "false"),
  ],
);

const loopList: TemplateGraph = graph(
  [
    node("start", "manual.trigger", "Run it", 0, 1, {
      sample: '{ "items": ["alpha", "beta", "gamma"] }',
    }),
    node("each_item", "logic.loop", "For each item", 1, 1, { items: "{{ start.items }}" }),
    node("handle", "logic.set", "Handle one item", 2, 0, {
      fields: [{ key: "item", value: "{{ $item }}" }],
    }),
    node("summary", "logic.set", "Summarise the batch", 2, 2, {
      fields: [
        { key: "count", value: "{{ each_item.count }}" },
        { key: "results", value: "{{ each_item.results }}" },
      ],
    }),
  ],
  [
    edge("start", "each_item"),
    edge("each_item", "handle", "each"),
    edge("each_item", "summary", "done"),
  ],
);

/** The Clerk feature slug a graph needs, or `undefined` when every node in it is unrestricted. */
export function templateFeature(template: TemplateGraph): string | undefined {
  for (const entry of template.nodes) {
    const feature = NODES[entry.data.nodeType]?.requiresFeature;
    if (feature) return feature;
  }
  return undefined;
}

/**
 * One node a template deliberately ships unconfigured, because only the reader can finish it: a
 * node that needs a connection. `credentialOptional` nodes are not listed — the Send email node
 * works on the platform key until an organisation connects its own Resend account.
 */
export type TemplateSetupStep = {
  /** The node's key, which is also its id in a template graph. */
  nodeId: string;
  /** The node's label, as the card and the canvas show it. */
  label: string;
  /** The `NodeDef.credential` slug it needs — `ai`, `chat`, `telegram`, a provider name. */
  credential: string;
};

/** What is left to do after picking this template, in graph order. */
export function templateSetup(template: TemplateGraph): TemplateSetupStep[] {
  const steps: TemplateSetupStep[] = [];
  for (const entry of template.nodes) {
    const definition = NODES[entry.data.nodeType];
    if (!definition?.credential || definition.credentialOptional) continue;
    steps.push({
      nodeId: entry.id,
      label: entry.data.label,
      credential: definition.credential,
    });
  }
  return steps;
}

/**
 * How a `NodeDef.credential` slug reads in a sentence like "Needs Telegram". `ai` and `chat` name
 * a set rather than a provider, so they get wording of their own; a provider slug is title-cased
 * from its own name in the connector registry by the caller when it wants the icon too.
 */
const CREDENTIAL_NAMES: Record<string, string> = {
  ai: "an AI provider",
  any: "an API token",
  chat: "Slack, Discord or Telegram",
  discord: "Discord",
  telegram: "Telegram",
  slack: "Slack",
  notion: "Notion",
  airtable: "Airtable",
  linear: "Linear",
  github: "GitHub",
  resend: "Resend",
  teams: "Microsoft Teams",
  stripe: "Stripe",
};

export function credentialName(credential: string): string {
  return CREDENTIAL_NAMES[credential] ?? credential;
}

function template(
  id: string,
  name: string,
  category: string,
  description: string,
  built: TemplateGraph,
): WorkflowTemplate {
  const feature = templateFeature(built);
  return {
    id,
    name,
    category,
    description,
    graph: built,
    ...(feature ? { requiresFeature: feature } : {}),
  };
}

/** The starter workflows, in the order the picker lists them. */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  template(
    "lead-intake",
    "Lead intake triage",
    "Lead capture",
    "A public form sorts each enquiry with AI, pings the team about the urgent ones and sends everyone else a holding reply.",
    leadIntake,
  ),
  template(
    "webhook-relay",
    "Webhook to API call",
    "Integrations",
    "Take an inbound webhook, forward it to an API of your choosing and keep the parts of the answer you care about.",
    webhookRelay,
  ),
  template(
    "hourly-check",
    "Hourly endpoint check",
    "Monitoring",
    "Call an endpoint every hour and email yourself what it answered. The interval is yours to change.",
    hourlyCheck,
  ),
  template(
    "approval-gate",
    "Approval before action",
    "Approvals",
    "Pause the run until somebody presses Approve or Reject in chat, then branch on what they chose.",
    approvalGate,
  ),
  template(
    "loop-list",
    "Loop over a list",
    "Batch work",
    "Run the same steps once per item in a list, then carry on once with a summary of the batch.",
    loopList,
  ),
];

/** One template by id, for a deep link or a canvas that was opened with a template in mind. */
export function templateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((entry) => entry.id === id);
}
