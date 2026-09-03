// Server only. Like `lib/inbound.ts` and `lib/vault.ts` (the `server-only` package is not installed
// in this workspace, so this comment is the guard): this module opens sealed credentials and talks
// to Convex with `ENGINE_SECRET`. Nothing here may be imported from a Client Component or any
// browser bundle — and nothing under `nodes/` or `connectors/` may import it either, because
// `lib/signatures/slack.ts` reaches `node:crypto` (CLAUDE.md rule 4).
import { listConnectionIdsByMeta, listConnectionsByExternalId } from "@/lib/engine-client";
import { resumeByStepId } from "@/lib/hooks";
import { loadConnection, type InboundConnection } from "@/lib/inbound";
import { verifySlack } from "@/lib/signatures/slack";
import { parseApprovalCallback } from "@/nodes/logic/approval";

/**
 * Everything the two Slack endpoints share.
 *
 * There are two because there have been two ideas about what identifies a Slack delivery.
 * `/api/events/slack/:connectionId` puts the answer in the URL, which is exact but unusable in an
 * app manifest: the manifest is what *produces* the token a connection is made from, so the id it
 * would need does not exist yet (this is the "the req url doesnt seem right?" placeholder).
 * `/api/events/slack` — one URL for the whole deployment — reads the workspace id Slack itself puts
 * in every delivery and looks the connections up by it.
 *
 * Both then do exactly the same thing, which is what lives here: prove the delivery with a
 * connection's own signing secret, resolve the pressed button to a suspended step, resume it, and
 * answer Slack inside its three seconds.
 *
 * Payload shapes are Slack's, not ours (docs.slack.dev): interactivity arrives as
 * `application/x-www-form-urlencoded` with a single `payload=<json>` field carrying `type`,
 * `team.id` (null only for an org-installed app, which this manifest's `org_deploy_enabled: false`
 * rules out), `api_app_id`, `user` and `actions`; the Events API arrives as JSON with top-level
 * `type`, `team_id` and `api_app_id`, and its one-time URL check is `{ type: "url_verification",
 * challenge }`.
 */

/** The stored `connections.provider` for a Slack bot token. */
export const SLACK_PROVIDER = "slack";

/** The `meta` key `connectors/slack.ts#test` writes the workspace id to, and indexes as `externalId`. */
export const SLACK_TEAM_META_KEY = "team_id";

/**
 * How many connections one workspace id may cost us before we stop looking.
 *
 * Each candidate is a Convex read plus an AES-GCM open, and Slack hangs up after three seconds. Two
 * organisations sharing one Slack workspace is plausible; six is somebody enumerating.
 */
const MAX_CANDIDATES = 5;

/** The slice of a `block_actions` payload these routes read. Everything else is ignored. */
type SlackUser = { username?: unknown; name?: unknown; id?: unknown };
type SlackAction = { value?: unknown; action_id?: unknown };
export type SlackPayload = {
  type?: unknown;
  user?: SlackUser;
  actions?: SlackAction[];
  team?: { id?: unknown } | null;
  api_app_id?: unknown;
};

/**
 * A delivery read only as far as "who sent this, and what kind of thing is it" — the part that
 * happens *before* anything is proved. Nothing on it is trustworthy until a signature has checked
 * out against the matching connection's signing secret.
 */
export type SlackDelivery = {
  /** `block_actions`, `event_callback`, `url_verification`, … or null when the body is unreadable. */
  type: string | null;
  /** The Slack workspace: `team.id` (interactivity) or `team_id` (Events API). */
  teamId: string | null;
  /** The Slack app, which both shapes carry. Logged on a mismatch; never used to authorise. */
  appId: string | null;
  /** The Events API URL check's echo value. */
  challenge: string | null;
  /**
   * Slack's certificate probe: `ssl_check=1` with a `token` and nothing else, which the docs say
   * to confirm with an empty 200 and otherwise ignore. It names no workspace, so it is recognised
   * here rather than being mistaken for a delivery that failed to parse.
   */
  sslCheck: boolean;
  /** The interactivity payload, parsed once here so no route parses the raw body twice. */
  payload: SlackPayload | null;
};

const EMPTY_DELIVERY: SlackDelivery = {
  type: null,
  teamId: null,
  appId: null,
  challenge: null,
  sslCheck: false,
  payload: null,
};

/** An HTTP-shaped refusal both routes answer with. */
export function slackFailure(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(rawBody: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

/**
 * Which workspace sent this, out of the raw bytes and nothing else.
 *
 * The body is read the way Slack sends it and never re-serialised: the signature covers
 * `v0:{ts}:{rawBody}` byte for byte, and a form-encoded payload would not survive a round trip
 * through `URLSearchParams` (CLAUDE.md rule 6). Reading is not trusting — the answer is used to
 * *look up* candidate connections, and one of their signing secrets then has to agree.
 */
export function readSlackDelivery(rawBody: string, contentType: string): SlackDelivery {
  if (contentType.toLowerCase().includes("json")) {
    const body = parseJson(rawBody);
    if (!body) return EMPTY_DELIVERY;

    return {
      ...EMPTY_DELIVERY,
      type: asString(body.type),
      teamId: asString(body.team_id),
      appId: asString(body.api_app_id),
      challenge: asString(body.challenge),
    };
  }

  const form = new URLSearchParams(rawBody);
  const encoded = form.get("payload");
  if (!encoded) return { ...EMPTY_DELIVERY, sslCheck: form.get("ssl_check") === "1" };

  const payload = parseJson(encoded);
  if (!payload) return EMPTY_DELIVERY;

  return {
    ...EMPTY_DELIVERY,
    type: asString(payload.type),
    // `team` is documented as nullable for an org-installed app; this app is not one.
    teamId: asString(asRecord(payload.team)?.id),
    appId: asString(payload.api_app_id),
    payload: payload as SlackPayload,
  };
}

/**
 * The Events API's one-time Request URL check, which Slack also runs against an interactivity URL
 * when both point at the same route. JSON in, the challenge back out.
 */
export function slackChallengeResponse(delivery: SlackDelivery): Response | null {
  if (delivery.type !== "url_verification" || !delivery.challenge) return null;
  return Response.json({ challenge: delivery.challenge });
}

/** Whoever pressed the button, as Slack names them. Never an email or anything else identifying. */
function pressedBy(user: SlackUser | undefined): string {
  for (const value of [user?.username, user?.name, user?.id]) {
    if (typeof value === "string" && value) return value;
  }
  return "someone";
}

/**
 * What both routes do once a delivery has been proved to come from the Slack app behind `orgId`'s
 * connection: resolve the pressed button to a suspended step and resume it.
 *
 * `orgId` is the whole authorisation for the resume. The button carries a step row id, which is not
 * a secret — all the delivery has proved is that *some* Slack workspace signed it — so the run it
 * names must belong to the same organisation as the connection it arrived on
 * (`lib/hooks.ts#resumeByStepId` re-checks that against the row).
 *
 * The answer body is a message: Slack replaces the original one with whatever JSON comes back, so
 * pressing Approve visibly turns the buttons into "✅ Approved by …" for everyone in the channel.
 * `resumeHook` returns as soon as the SDK has the payload; the run carries on without this request.
 */
export async function handleVerifiedSlackDelivery(args: {
  delivery: SlackDelivery;
  orgId: string;
  /** Which endpoint answered, for the one log line a failed resume writes. */
  source: string;
}): Promise<Response> {
  const { delivery, orgId, source } = args;

  const challenge = slackChallengeResponse(delivery);
  if (challenge) return challenge;

  // Past the signature check, so anything unreadable is Slack sending something this build does not
  // act on. A retry would send the same bytes, so it is accepted rather than refused.
  const payload = delivery.payload;
  if (!payload || delivery.type !== "block_actions") return Response.json({ ok: true });

  const action = payload.actions?.[0];
  const callback = parseApprovalCallback(action?.value);
  if (!callback) return Response.json({ ok: true });

  const by = pressedBy(payload.user);

  try {
    const resumed = await resumeByStepId(
      callback.stepId,
      {
        approved: callback.approved,
        by,
        provider: SLACK_PROVIDER,
        // `runGraph` follows a resumed payload's `handle` over the node's own.
        handle: callback.approved ? "approved" : "rejected",
      },
      orgId,
    );

    // 200 either way: a non-2xx shows the presser a red error banner, and "this already happened"
    // is not an error. The body says so instead.
    if (!resumed.ok) {
      return Response.json({
        replace_original: true,
        text: "This approval is no longer waiting — the run has already moved on.",
        error: "not_waiting",
      });
    }

    return Response.json({
      replace_original: true,
      text: callback.approved ? `✅ Approved by ${by}` : `❌ Rejected by ${by}`,
    });
  } catch (cause) {
    console.error(`slack: could not resume the run (${source})`, cause);
    return slackFailure(502, "resume_failed", "The run could not be resumed. Try again.");
  }
}

/** The connection a delivery proved itself against, or the refusal the route should answer with. */
export type SlackConnectionMatch =
  | { ok: true; connectionId: string; connection: InboundConnection }
  | { ok: false; status: number; code: string; error: string };

const NO_SUCH_WORKSPACE: SlackConnectionMatch = {
  ok: false,
  status: 404,
  code: "not_found",
  error: "No Slack app is listening at this URL.",
};

/**
 * The connection whose signing secret signed this delivery, found from the workspace id inside it.
 *
 * Two lookups, in this order. `externalId` is the indexed copy of `meta.team_id` that
 * `connectors/slack.ts#externalIdFrom` writes at create and re-test time — a point read. Rows added
 * before that column existed have the workspace only in `meta`, which Convex cannot index, so a
 * connection the index does not know is looked for once more with a capped scan of Slack's rows.
 * The fallback is second because it is the expensive one, and it disappears on its own: any
 * connection someone re-tests gets its column filled in.
 *
 * More than one candidate is normal — two organisations can install the same Slack app into the
 * same workspace — so each is tried in turn and the *signature* picks the winner. That is also what
 * makes this safe: the workspace id is attacker-supplied, and all it can do is choose which
 * signing secrets a forged body will fail against.
 */
export async function findVerifiedSlackConnection(args: {
  rawBody: string;
  teamId: string;
  timestamp: string | null;
  signature: string | null;
}): Promise<SlackConnectionMatch> {
  const matches = await listConnectionsByExternalId({
    provider: SLACK_PROVIDER,
    externalId: args.teamId,
  });

  const candidateIds =
    matches.length > 0
      ? matches.map((match) => match.id as string)
      : await listConnectionIdsByMeta({
          provider: SLACK_PROVIDER,
          key: SLACK_TEAM_META_KEY,
          value: args.teamId,
        });

  let opened = 0;
  let withSigningSecret = 0;

  for (const connectionId of candidateIds.slice(0, MAX_CANDIDATES)) {
    // Re-reads the row, refuses another provider's or a revoked one, and opens the sealed blob —
    // the same gate the per-connection route goes through, so the two cannot disagree about which
    // connections are allowed to receive a delivery.
    const connection = await loadConnection(connectionId, SLACK_PROVIDER);
    if (!connection) continue;
    opened += 1;

    const signingSecret =
      typeof connection.secret.signingSecret === "string" ? connection.secret.signingSecret : "";
    if (!signingSecret) continue;
    withSigningSecret += 1;

    if (verifySlack(args.rawBody, args.timestamp, args.signature, signingSecret).ok) {
      return { ok: true, connectionId, connection };
    }
  }

  // Nothing this deployment holds claims that workspace — the same answer a stranger's POST gets,
  // and it says nothing about which workspaces do exist here.
  if (opened === 0) return NO_SUCH_WORKSPACE;

  if (withSigningSecret === 0) {
    // The field is optional at connect time, so this is a real and fixable state rather than an
    // attack: the workspace is connected for sending and nobody has pasted the signing secret yet.
    return {
      ok: false,
      status: 400,
      code: "no_signing_secret",
      error: "This Slack connection has no signing secret configured.",
    };
  }

  // One answer for a forged signature, a stale timestamp and a missing header: the sender learns
  // that the delivery was refused, not which check refused it.
  return {
    ok: false,
    status: 401,
    code: "bad_signature",
    error: "This delivery could not be verified.",
  };
}
