---
description: Use when choosing how a workflow starts — Manual, Webhook, Form, Schedule, Telegram or Stripe.
---

# Choosing a trigger

Every workflow has exactly one trigger, and it is the first node you add.

- **`manual.trigger`** — the Run button, with a JSON sample the user types. The right default when
  the user says "a workflow that…" and never says when it should happen.
- **`form.trigger`** — a public page at `/f/<workflowId>` with the fields you configure. Reach for it
  when a person supplies the data ("a form where people request…"). Its output is the submitted
  fields, so `{{ form_trigger_1.email }}`.
- **`webhook.trigger`** — an HTTP URL another system posts to. The URL carries a secret, so the user
  copies it from the node's own panel; you never print it.
- **`schedule.trigger`** — a cron expression. "Every morning", "each Monday". The free plan's
  shortest interval is an hour.
- **`telegram.message`** / **`stripe.event`** — inbound events on an existing connection. Both need
  that connection configured on the trigger node itself.

Two triggers is a refusal, not a warning: `add_node` will not place a second one.
