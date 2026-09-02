import { z } from "zod";

import { CHAT_CREDENTIAL, TARGETS_PICKER } from "@/connectors/define";
import { ConnectorError, defineNode } from "../define";

/**
 * Ask a person, in the chat app they already have open, and suspend the run until they answer.
 *
 * The node posts one message with two buttons and returns `control: { kind: "hook" }`, which is
 * what actually pauses the run: `runNode` leaves the step row `waiting` with the hook token on it,
 * `runGraph` opens `createHook({ token })` and awaits it, and the provider's interactivity route
 * (`app/api/events/{slack,discord,telegram}/[connectionId]`) calls `resumeHook`. The payload that
 * arrives becomes this node's output and names the branch — so `run` only ever returns
 * `{ posted, provider }`, and `approved`/`by` appear on the row when someone has actually pressed
 * something.
 *
 * One node, three providers, because the shape is identical: a message, two buttons, and a callback
 * id the button carries back. Only the JSON differs — Block Kit `value`, a component `custom_id`,
 * an inline keyboard's `callback_data` — which is the whole of `postApproval` below.
 *
 * `credential: "chat"` is deliberately narrower than the chat category: a Discord *webhook* can
 * post a message but can never receive a button press back, and a Teams Workflows webhook does not
 * render buttons at all (docs/research/connectors-chat.md).
 */

/** The two branches. The resumed payload picks one; `runGraph` follows it. */
export const APPROVED_HANDLE = "approved";
export const REJECTED_HANDLE = "rejected";

/**
 * What a button carries, and the reason it is the step row's Convex id rather than the hook token.
 *
 * Telegram caps `callback_data` at 64 *bytes* and a hook token is `${executionId}:${nodeId}` plus
 * an optional loop pass — unbounded, and easily over the cap once a user names a node. A Convex id
 * is 32 characters, so `approve:<id>` is 40 and always will be. The resume route reads the row back
 * (`convex/engine.ts#getStepById`) and derives the token from the ids on it.
 *
 * It is an address, not a capability: the routes verify the provider's signature first and then
 * check that the row belongs to the same organisation as the connection the press arrived on.
 */
export function approvalCallbackId(decision: "approve" | "reject", stepId: string): string {
  return `${decision}:${stepId}`;
}

/** `approve:<stepId>` → `{ approved, stepId }`, or null for anything this node did not send. */
export function parseApprovalCallback(value: unknown): { approved: boolean; stepId: string } | null {
  if (typeof value !== "string") return null;

  const separator = value.indexOf(":");
  if (separator === -1) return null;

  const decision = value.slice(0, separator);
  const stepId = value.slice(separator + 1);
  if (!stepId) return null;
  if (decision !== "approve" && decision !== "reject") return null;

  return { approved: decision === "approve", stepId };
}

/** Telegram's own limit on `callback_data`; the ids above are well inside it, but not by accident. */
const TELEGRAM_CALLBACK_LIMIT = 64;

const TIMEOUT_MS = 30_000;

const approvalInputs = z.object({
  connectionId: z.string(),
  target: z
    .string()
    .min(1)
    .meta({ picker: TARGETS_PICKER })
    .describe("The Slack or Discord channel, or the Telegram chat, to ask in"),
  message: z.string().min(1).describe("What the approver sees above the buttons"),
  approveLabel: z.string().min(1).max(75).default("Approve"),
  rejectLabel: z.string().min(1).max(75).default("Reject"),
});

type ApprovalInputs = z.infer<typeof approvalInputs>;

function credentialString(credential: Record<string, unknown> | undefined, field: string): string {
  const value = credential?.[field];
  return typeof value === "string" ? value : "";
}

/** The step row id this node's buttons must carry, or a configuration-shaped failure. */
function requireStepId(stepId: string | undefined): string {
  if (!stepId) {
    throw new ConnectorError("Approval: this run gave the node no step to resume.", 400);
  }
  return stepId;
}

/**
 * `chat.postMessage` with an actions block. `text` stays beside `blocks` because it is what Slack
 * uses for the notification and for screen readers.
 */
async function postSlack(inputs: ApprovalInputs, token: string, stepId: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: inputs.target,
      text: inputs.message,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: inputs.message } },
        {
          type: "actions",
          block_id: "papaflow_approval",
          elements: [
            {
              type: "button",
              action_id: "approve",
              style: "primary",
              text: { type: "plain_text", text: inputs.approveLabel },
              value: approvalCallbackId("approve", stepId),
            },
            {
              type: "button",
              action_id: "reject",
              style: "danger",
              text: { type: "plain_text", text: inputs.rejectLabel },
              value: approvalCallbackId("reject", stepId),
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 429) {
    throw new ConnectorError(
      "Slack rate limit reached for this channel.",
      429,
      response.headers.get("retry-after") ?? undefined,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: unknown };
  if (payload.ok !== true) {
    const described = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    // Slack answers 200 with `{ ok: false }` for `channel_not_found`, `not_in_channel` and
    // `invalid_auth` alike: all configuration, none worth retrying.
    throw new ConnectorError(`Slack refused the approval message: ${described}`, 400);
  }
}

/** A bot message with one action row of two buttons: style 3 is green (success), 4 is red (danger). */
async function postDiscord(inputs: ApprovalInputs, token: string, stepId: string): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${inputs.target}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: inputs.message,
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: inputs.approveLabel,
                custom_id: approvalCallbackId("approve", stepId),
              },
              {
                type: 2,
                style: 4,
                label: inputs.rejectLabel,
                custom_id: approvalCallbackId("reject", stepId),
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (response.ok) return;

  const body = (await response.json().catch(() => ({}))) as {
    message?: unknown;
    retry_after?: unknown;
  };

  if (response.status === 429) {
    // Discord reports the wait in the JSON body as seconds, not in a `Retry-After` header.
    const seconds = typeof body.retry_after === "number" ? String(body.retry_after) : undefined;
    throw new ConnectorError("Discord rate limit reached.", 429, seconds);
  }

  const described = typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
  throw new ConnectorError(`Discord refused the approval message: ${described}`, response.status);
}

/** `sendMessage` with an inline keyboard. The token is in the URL, so no failure path echoes it. */
async function postTelegram(inputs: ApprovalInputs, token: string, stepId: string): Promise<void> {
  const buttons = [
    { text: inputs.approveLabel, callback_data: approvalCallbackId("approve", stepId) },
    { text: inputs.rejectLabel, callback_data: approvalCallbackId("reject", stepId) },
  ];

  for (const button of buttons) {
    // Telegram counts bytes, and silently rejects the whole message when a button is over.
    if (new TextEncoder().encode(button.callback_data).length > TELEGRAM_CALLBACK_LIMIT) {
      throw new ConnectorError("Approval: this run's id is too long for a Telegram button.", 400);
    }
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: inputs.target,
      text: inputs.message,
      reply_markup: { inline_keyboard: [buttons] },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: unknown;
    parameters?: { retry_after?: unknown };
  };
  if (payload.ok === true) return;

  const described =
    typeof payload.description === "string" ? payload.description : `HTTP ${response.status}`;

  if (response.status === 429) {
    const retryAfter = payload.parameters?.retry_after;
    throw new ConnectorError(
      `Telegram rate limit reached: ${described}`,
      429,
      typeof retryAfter === "number" ? String(retryAfter) : undefined,
    );
  }

  throw new ConnectorError(
    `Telegram refused the approval message: ${described}`,
    // A 5xx is Telegram's problem and worth the default retries; everything else is the
    // configuration's (a wrong chat id, a channel the bot was removed from).
    response.status >= 500 ? response.status : 400,
  );
}

export const approvalNode = defineNode({
  type: "logic.approval",
  name: "Approval",
  description:
    "Ask someone in Slack, Discord or Telegram to approve, and pause the run until they answer.",
  category: "logic",
  icon: "ShieldCheck",
  credential: CHAT_CREDENTIAL,
  requiresFeature: null,
  version: "v1",
  inputs: approvalInputs,
  outputs: z.object({
    /** True once the message is out; the answer has not arrived yet when `run` returns. */
    posted: z.boolean(),
    /** Which chat app was asked — `slack`, `discord-bot` or `telegram`. */
    provider: z.string(),
    /** Filled in by the resume: what the approver decided. */
    approved: z.boolean().optional(),
    /** Filled in by the resume: who they were, as their chat app names them. */
    by: z.string().optional(),
  }),
  handles: () => [APPROVED_HANDLE, REJECTED_HANDLE],
  // The branch is not knowable here — nobody has pressed anything yet — so it comes off the resumed
  // payload's `handle` in `runGraph` instead of from `handle(out)`.
  control: () => ({ kind: "hook" }),
  async run({ inputs, credential, stepId }) {
    const provider = credentialString(credential, "provider");
    const token = credentialString(credential, "botToken");
    if (!token) {
      throw new ConnectorError("This chat connection has no bot token — reconnect it.", 400);
    }

    const step = requireStepId(stepId);

    if (provider === "slack") await postSlack(inputs, token, step);
    else if (provider === "discord-bot") await postDiscord(inputs, token, step);
    else if (provider === "telegram") await postTelegram(inputs, token, step);
    else {
      throw new ConnectorError(
        `Approval needs a Slack, Discord bot or Telegram connection, not ${provider || "that one"}.`,
        400,
      );
    }

    return { posted: true, provider };
  },
});
