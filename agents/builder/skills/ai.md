---
description: Use when a step needs a model — summarising, extracting fields, classifying, or an agent that calls connectors.
---

# The AI nodes

All four run on one of the workspace's own AI connections (`connectionId` plus `model`), so check
`list_connections` for an `openai`, `anthropic`, `google`, `groq` or similar connection first.

- **`ai.llm`** — a prompt in, text out. The general one. Put the incoming data in the prompt with
  templates: `Summarise this: {{ http_request_1.body }}`.
- **`ai.extract`** — a prompt plus a list of fields, and structured JSON out. Use it whenever the
  next node needs a *field* rather than a paragraph, so the workflow does not have to parse prose.
- **`ai.classify`** — a prompt plus a list of categories; its output is one of them, which pairs
  naturally with a Switch on `{{ ai_classify_1.category }}`.
- **`ai.agent`** — a goal in plain words, and the workspace's connectors as its tools. Use it only
  when the work genuinely needs judgement about *which* action to take; a workflow that always does
  the same three things should be three nodes, not an agent.

`model` must be one of the ids the connection reported when it was added. If you are unsure, leave
`model` unset and tell the user to pick it in the node's panel.
