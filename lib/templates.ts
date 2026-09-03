// Starter workflows: thirteen graphs a new organisation can open instead of an empty canvas.
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

/**
 * Support inbox autopilot: one webhook in, four ways out.
 *
 * The Switch is the whole idea. Classify turns free text into one of four labels, and each label
 * gets the treatment it deserves — a bug becomes a GitHub issue, a billing question goes to a
 * person, a feature request is logged in Notion — while `default` catches everything nobody thought
 * to categorise and answers it rather than filing it.
 */
const supportAutopilot: TemplateGraph = graph(
  [
    node("inbox", "webhook.trigger", "Ticket arrives", 0, 2),
    node("category", "ai.classify", "What kind of ticket?", 1, 2, {
      connectionId: "",
      model: "",
      text: "{{ inbox.body.subject }}\n\n{{ inbox.body.message }}",
      labels: ["bug", "billing", "feature request", "question"],
      instructions: "Pick the label for what the customer needs, not for how politely they asked.",
    }),
    node("route", "logic.switch", "Send it the right way", 2, 2, {
      value: "{{ category.label }}",
      cases: ["bug", "billing", "feature request"],
    }),
    node("bug_issue", "github.createIssue", "File the bug", 3, 0, {
      connectionId: "",
      title: "Bug report: {{ inbox.body.subject }}",
      body: "Reported by {{ inbox.body.from }}.\n\n{{ inbox.body.message }}",
      labels: ["bug", "from-support"],
    }),
    node("billing_handoff", "email.send", "Hand billing to a person", 3, 1, {
      to: "billing@example.com",
      subject: "Billing question from {{ inbox.body.from }}",
      text: "{{ inbox.body.message }}",
    }),
    node("feature_page", "notion.createPage", "Log the request", 3, 2, {
      connectionId: "",
      dataSourceId: "",
      title: "{{ inbox.body.subject }}",
      properties: [],
    }),
    node("reply", "ai.llm", "Draft a reply", 3, 3, {
      connectionId: "",
      model: "",
      instructions:
        "You are a friendly support agent. Answer in under 120 words. If you are not sure of the " +
        "answer, say a human will follow up rather than guessing.",
      prompt: "The customer wrote:\n\n{{ inbox.body.message }}",
    }),
    node("send_reply", "email.send", "Send the reply", 4, 3, {
      to: "{{ inbox.body.from }}",
      subject: "Re: {{ inbox.body.subject }}",
      text: "{{ reply.text }}",
    }),
  ],
  [
    edge("inbox", "category"),
    edge("category", "route"),
    edge("route", "bug_issue", "bug"),
    edge("route", "billing_handoff", "billing"),
    // The handle ids are the case strings exactly as they are written above, spaces and all.
    edge("route", "feature_page", "feature request"),
    edge("route", "reply", "default"),
    edge("reply", "send_reply"),
  ],
);

/**
 * Morning tech digest: a cron, a public API, and a Loop that summarises each result on its own.
 *
 * The body wired to `each` sees one story as `{{ $item }}`; the chain after `done` reads every
 * answer at once as `{{ stories.results }}`. That is the whole shape of a map-then-reduce here —
 * five small prompts, then one that writes the email.
 */
const morningDigest: TemplateGraph = graph(
  [
    node("every_morning", "schedule.trigger", "Weekday mornings", 0, 1, {
      mode: "cron",
      cron: "0 8 * * 1-5",
      timezone: "UTC",
    }),
    node("top_stories", "http.request", "Fetch the front page", 1, 1, {
      method: "GET",
      url: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5",
      auth: "none",
    }),
    node("stories", "logic.loop", "For each story", 2, 1, { items: "{{ top_stories.body.hits }}" }),
    node("summarise", "ai.llm", "Summarise one story", 3, 0, {
      connectionId: "",
      model: "",
      instructions: "You write like a good newsletter: concrete, specific, never breathless.",
      prompt:
        "In one punchy sentence of 25 words or fewer, say why this matters: " +
        "{{ $item.title }} ({{ $item.url }}, {{ $item.points }} points).",
    }),
    node("digest", "ai.llm", "Write the digest", 3, 2, {
      connectionId: "",
      model: "",
      instructions: "You write a short daily newsletter for one reader.",
      prompt:
        "Turn these summaries into a friendly digest with a one-line intro, a numbered list and a " +
        "sign-off:\n\n{{ stories.results }}",
    }),
    node("send_digest", "email.send", "Email it to yourself", 4, 2, {
      to: "you@example.com",
      subject: "Your morning tech digest",
      text: "{{ digest.text }}",
    }),
  ],
  [
    edge("every_morning", "top_stories"),
    edge("top_stories", "stories"),
    edge("stories", "summarise", "each"),
    edge("stories", "digest", "done"),
    edge("digest", "send_digest"),
  ],
);

/**
 * Stripe payment → welcome sequence: buy, get welcomed, get checked on three days later.
 *
 * The Pause in the middle is the point. The run is suspended rather than left spinning, so the
 * three-day gap costs exactly as much compute as the thirty-second one in any other template.
 */
const stripeWelcome: TemplateGraph = graph(
  [
    node("payment", "stripe.event", "Payment completed", 0, 0, {
      connectionId: "",
      eventTypes: ["checkout.session.completed"],
    }),
    node("welcome_copy", "ai.llm", "Write the welcome", 1, 0, {
      connectionId: "",
      model: "",
      instructions: "You write warm, plain-spoken customer email. No exclamation marks.",
      prompt:
        "Write a three-sentence welcome for {{ payment.object.customer_details.email }}, who just " +
        "paid {{ payment.object.amount_total }} minor units in {{ payment.object.currency }}. " +
        'Sign off as "The team".',
    }),
    node("welcome_email", "email.send", "Send the welcome", 2, 0, {
      to: "{{ payment.object.customer_details.email }}",
      subject: "Welcome aboard",
      text: "{{ welcome_copy.text }}",
    }),
    node("ledger", "airtable.createRecord", "Log the payment", 3, 0, {
      connectionId: "",
      baseId: "",
      tableId: "",
      fields: [
        { key: "Email", value: "{{ payment.object.customer_details.email }}" },
        { key: "Amount", value: "{{ payment.object.amount_total }}" },
        { key: "Currency", value: "{{ payment.object.currency }}" },
        { key: "Status", value: "Paid" },
      ],
    }),
    // Three days, held by the SDK's timer rather than by a function sitting there awake.
    node("three_days", "logic.wait", "Wait three days", 4, 0, {
      mode: "duration",
      seconds: 259200,
    }),
    node("checkin_email", "email.send", "Check in", 5, 0, {
      to: "{{ payment.object.customer_details.email }}",
      subject: "How's it going?",
      text: "You have had three days with us now. Anything we can help with? Reply and a person will read it.",
    }),
  ],
  [
    edge("payment", "welcome_copy"),
    edge("welcome_copy", "welcome_email"),
    edge("welcome_email", "ledger"),
    edge("ledger", "three_days"),
    edge("three_days", "checkin_email"),
  ],
);

/**
 * Blog post with editorial approval: a brief goes in, a draft comes back, a human decides.
 *
 * Two prompts in sequence — outline, then post — because a model given the outline it just wrote
 * stays on topic better than one asked for 500 words cold. The Approval suspends the run until
 * somebody presses a button in chat, so the draft is never published unread.
 */
const contentPipeline: TemplateGraph = graph(
  [
    node("brief", "form.trigger", "The brief", 0, 1, {
      title: "Request a blog post",
      description: "Tell us what to write and who it is for.",
      fields: [
        { name: "topic", label: "Topic", type: "text", required: true },
        { name: "audience", label: "Who is it for?", type: "text", required: true },
        {
          name: "tone",
          label: "Tone",
          type: "select",
          required: true,
          options: ["Friendly", "Professional", "Playful"],
        },
      ],
      submitLabel: "Draft it",
    }),
    node("outline", "ai.llm", "Outline it", 1, 1, {
      connectionId: "",
      model: "",
      instructions: "You are a senior content strategist. Structure first, prose later.",
      prompt:
        "Write a five-point outline for a blog post on {{ brief.values.topic }} for " +
        "{{ brief.values.audience }}, in a {{ brief.values.tone }} tone.",
    }),
    node("draft", "ai.llm", "Write the draft", 2, 1, {
      connectionId: "",
      model: "",
      instructions: "You write clear, concrete posts. No filler, no throat-clearing intro.",
      prompt: "Write the full post, about 500 words, from this outline:\n\n{{ outline.text }}",
      maxOutputTokens: 2048,
    }),
    node("review", "logic.approval", "Editor signs off", 3, 1, {
      connectionId: "",
      target: "",
      message: "Publish this post on {{ brief.values.topic }}?\n\n{{ draft.text }}",
      approveLabel: "Publish",
      rejectLabel: "Needs work",
    }),
    node("publish", "notion.createPage", "Publish to Notion", 4, 0, {
      connectionId: "",
      dataSourceId: "",
      title: "{{ brief.values.topic }}",
      properties: [],
    }),
    node("notify_writer", "email.send", "Send it back", 4, 2, {
      to: "writer@example.com",
      subject: "Draft needs work: {{ brief.values.topic }}",
      text: "The editor sent this back. Here is the draft as it stands:\n\n{{ draft.text }}",
    }),
  ],
  [
    edge("brief", "outline"),
    edge("outline", "draft"),
    edge("draft", "review"),
    edge("review", "publish", "approved"),
    edge("review", "notify_writer", "rejected"),
  ],
);

/**
 * Website watchdog with escalation: nobody is paged for one bad response.
 *
 * A failed check pings the team, waits five minutes and checks again; only the second failure
 * escalates to email. A recovery in between says so and the run ends quietly, which is the
 * difference between a monitor people trust and one they mute.
 */
const siteWatchdog: TemplateGraph = graph(
  [
    node("every_five", "schedule.trigger", "Every five minutes", 0, 2, {
      mode: "every",
      everyMinutes: 5,
    }),
    node("ping", "http.request", "Check the site", 1, 2, {
      method: "GET",
      url: "https://example.com",
      auth: "none",
    }),
    node("is_down", "logic.condition", "Is it down?", 2, 2, {
      left: "{{ ping.status }}",
      operator: "notEquals",
      right: "200",
    }),
    node("alert", "telegram.sendMessage", "Warn the team", 3, 0, {
      connectionId: "",
      chatId: "",
      text: "⚠️ example.com answered {{ ping.status }} at {{ every_five.firedAt }}. Checking again in 5 minutes.",
      parseMode: "none",
    }),
    node("hold", "logic.wait", "Give it five minutes", 4, 0, {
      mode: "duration",
      seconds: 300,
    }),
    node("recheck", "http.request", "Check again", 5, 0, {
      method: "GET",
      url: "https://example.com",
      auth: "none",
    }),
    node("still_down", "logic.condition", "Still down?", 6, 0, {
      left: "{{ recheck.status }}",
      operator: "notEquals",
      right: "200",
    }),
    node("escalate", "email.send", "Page the on-call", 7, 0, {
      to: "oncall@example.com",
      subject: "example.com is still down",
      text: "Two checks five minutes apart both failed: {{ ping.status }}, then {{ recheck.status }}.",
    }),
    node("recovered", "telegram.sendMessage", "Say it recovered", 7, 1, {
      connectionId: "",
      chatId: "",
      text: "✅ example.com is back, {{ recheck.status }}.",
      parseMode: "none",
    }),
    node("all_good", "logic.set", "Nothing to do", 3, 3, {
      fields: [{ key: "status", value: "{{ ping.status }}" }],
    }),
  ],
  [
    edge("every_five", "ping"),
    edge("ping", "is_down"),
    edge("is_down", "alert", "true"),
    edge("alert", "hold"),
    edge("hold", "recheck"),
    edge("recheck", "still_down"),
    edge("still_down", "escalate", "true"),
    edge("still_down", "recovered", "false"),
    edge("is_down", "all_good", "false"),
  ],
);

/**
 * Telegram AI concierge: the shortest useful agent there is.
 *
 * Three nodes, and the middle one is the Agent — it answers with the workspace's own connections as
 * tools, so what it can do grows every time somebody connects something new. `ai_agent` is a Pro
 * feature, and `templateFeature` reads that off the registry rather than being told.
 */
const telegramConcierge: TemplateGraph = graph(
  [
    node("message", "telegram.message", "Someone messages the bot", 0, 0, { connectionId: "" }),
    node("concierge", "ai.agent", "Work out an answer", 1, 0, {
      connectionId: "",
      model: "",
      goal:
        "You are a helpful concierge for our team. Answer this message, using the connected tools " +
        "when they would help: {{ message.text }}",
      maxSteps: 6,
    }),
    node("reply", "telegram.sendMessage", "Reply in the chat", 2, 0, {
      connectionId: "",
      chatId: "{{ message.chatId }}",
      text: "{{ concierge.text }}",
      parseMode: "none",
    }),
  ],
  [edge("message", "concierge"), edge("concierge", "reply")],
);

/**
 * Meeting notes → action items: paste the notes, get the tickets.
 *
 * Extract is configured with a single `string[]` field, so the model has to answer with a list and
 * the Loop after it has something real to iterate. Each item becomes one GitHub issue; the chain
 * after `done` reports how many there were.
 */
const meetingActions: TemplateGraph = graph(
  [
    node("notes", "form.trigger", "Paste the notes", 0, 1, {
      title: "Paste your meeting notes",
      description: "Whatever you typed during the call is fine — bullets, half sentences, all of it.",
      fields: [
        { name: "title", label: "Meeting", type: "text", required: true },
        { name: "notes", label: "Notes", type: "textarea", required: true },
      ],
      submitLabel: "Extract actions",
    }),
    node("actions", "ai.extract", "Find the actions", 1, 1, {
      connectionId: "",
      model: "",
      prompt: "Extract every action item from these meeting notes:\n\n{{ notes.values.notes }}",
      fields: [
        {
          name: "items",
          type: "string[]",
          description:
            "One entry per action item, imperative, with the owner's name if it is mentioned.",
        },
      ],
    }),
    node("each_action", "logic.loop", "For each action", 2, 1, { items: "{{ actions.items }}" }),
    node("ticket", "github.createIssue", "Open a ticket", 3, 0, {
      connectionId: "",
      title: "{{ $item }}",
      body: "From meeting: {{ notes.values.title }}",
      labels: ["action-item"],
    }),
    node("summary", "email.send", "Send the recap", 3, 2, {
      to: "team@example.com",
      subject: "{{ each_action.count }} action items from {{ notes.values.title }}",
      text: "Here is what we agreed to do:\n\n{{ actions.items }}",
    }),
  ],
  [
    edge("notes", "actions"),
    edge("actions", "each_action"),
    edge("each_action", "ticket", "each"),
    edge("each_action", "summary", "done"),
  ],
);

/**
 * Invoice intake with sign-off: small invoices file themselves, big ones need a person.
 *
 * Extract turns pasted text into four typed fields, and because `amount` is a number the Condition
 * after it can compare it properly. Only what is over the threshold reaches a human, which is the
 * only way an approval step stays worth reading.
 */
const invoiceApproval: TemplateGraph = graph(
  [
    node("invoice", "form.trigger", "Log an invoice", 0, 1, {
      title: "Log an invoice",
      fields: [
        { name: "invoice_text", label: "Paste the invoice text", type: "textarea", required: true },
      ],
      submitLabel: "Log it",
    }),
    node("details", "ai.extract", "Read the invoice", 1, 1, {
      connectionId: "",
      model: "",
      prompt:
        "Read this invoice and pull out the vendor, the amount, the currency and the due " +
        "date:\n\n{{ invoice.values.invoice_text }}",
      fields: [
        { name: "vendor", type: "string", description: "Who is being paid" },
        { name: "amount", type: "number", description: "The total, as a number and nothing else" },
        { name: "currency", type: "string", description: "Three-letter code, e.g. GBP" },
        { name: "due_date", type: "string", description: "The due date as written on the invoice" },
      ],
    }),
    node("big_spend", "logic.condition", "Over a thousand?", 2, 1, {
      left: "{{ details.amount }}",
      operator: "greaterThan",
      right: "1000",
    }),
    node("sign_off", "logic.approval", "Ask for sign-off", 3, 0, {
      connectionId: "",
      target: "",
      message:
        "Pay {{ details.amount }} {{ details.currency }} to {{ details.vendor }}, due " +
        "{{ details.due_date }}?",
      approveLabel: "Pay it",
      rejectLabel: "Hold",
    }),
    node("record", "airtable.createRecord", "Record it as approved", 4, 0, {
      connectionId: "",
      baseId: "",
      tableId: "",
      fields: [
        { key: "Vendor", value: "{{ details.vendor }}" },
        { key: "Amount", value: "{{ details.amount }}" },
        { key: "Due", value: "{{ details.due_date }}" },
        { key: "Status", value: "Approved" },
      ],
    }),
    node("held", "email.send", "Tell finance it is held", 4, 1, {
      to: "finance@example.com",
      subject: "Invoice held: {{ details.vendor }}",
      text: "{{ details.vendor }} asked for {{ details.amount }} {{ details.currency }} and it was held rather than paid.",
    }),
    node("record_small", "airtable.createRecord", "Record it as auto-approved", 3, 3, {
      connectionId: "",
      baseId: "",
      tableId: "",
      fields: [
        { key: "Vendor", value: "{{ details.vendor }}" },
        { key: "Amount", value: "{{ details.amount }}" },
        { key: "Due", value: "{{ details.due_date }}" },
        { key: "Status", value: "Auto-approved" },
      ],
    }),
  ],
  [
    edge("invoice", "details"),
    edge("details", "big_spend"),
    edge("big_spend", "sign_off", "true"),
    edge("sign_off", "record", "approved"),
    edge("sign_off", "held", "rejected"),
    edge("big_spend", "record_small", "false"),
  ],
);

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
    "support-autopilot",
    "Support inbox autopilot",
    "Customer support",
    "Classifies every incoming ticket, files bugs in GitHub, hands billing to a human, logs feature requests in Notion and drafts an AI reply for everything else.",
    supportAutopilot,
  ),
  template(
    "morning-digest",
    "Morning tech digest",
    "Content",
    "Every weekday at 8:00 it pulls the front page of Hacker News, has the model summarise each story, and emails you a five-line digest.",
    morningDigest,
  ),
  template(
    "stripe-welcome",
    "Stripe payment → welcome sequence",
    "Revenue",
    "A completed checkout gets a written welcome, a row in your ledger, and a check-in three days later — a wait the run sleeps through without holding any compute.",
    stripeWelcome,
  ),
  template(
    "content-pipeline",
    "Blog post with editorial approval",
    "Content",
    "A brief becomes an outline, then a full draft, then a question in chat: publish it to Notion, or send it back to the writer with the draft attached.",
    contentPipeline,
  ),
  template(
    "site-watchdog",
    "Website watchdog with escalation",
    "Monitoring",
    "Checks your site every five minutes and warns the team on the first bad response — but nobody is paged until a second check five minutes later fails too.",
    siteWatchdog,
  ),
  template(
    "telegram-concierge",
    "Telegram AI concierge",
    "AI agents",
    "An agent that answers your team in Telegram and can reach for every connection in the workspace as a tool.",
    telegramConcierge,
  ),
  template(
    "meeting-actions",
    "Meeting notes → action items",
    "Productivity",
    "Paste the notes you typed during the call and get one GitHub issue per action item, plus a recap email telling the team how many there were.",
    meetingActions,
  ),
  template(
    "invoice-approval",
    "Invoice intake with sign-off",
    "Finance",
    "Reads a pasted invoice into typed fields, records anything under a thousand on its own, and asks a person before anything larger is paid.",
    invoiceApproval,
  ),
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
