import { resumeByStepId } from "@/lib/hooks";
import { loadConnection } from "@/lib/inbound";
import { verifyDiscord } from "@/lib/signatures/discord";
import { parseApprovalCallback } from "@/nodes/logic/approval";

/**
 * `POST /api/events/discord/:connectionId` — this Discord application's Interactions Endpoint URL.
 *
 * Per connection, like the rest of `/api/events`: the application belongs to the user, and the
 * public key that proves a delivery is on *their* connection (`meta.publicKey` — published in
 * Discord's own dashboard, so it is not a secret and does not live in the sealed blob).
 *
 * Two things are non-negotiable here. The raw body is read first, because the Ed25519 signature
 * covers `timestamp + rawBody` byte for byte (CLAUDE.md rule 6). And a failed verification must be
 * a **401**: when an Interactions Endpoint URL is saved, Discord posts both valid and deliberately
 * invalid signatures, and an endpoint that accepts an invalid one is rejected — or, later, removed.
 *
 * Discord gives an interaction three seconds. Type 7 (UPDATE_MESSAGE) is the answer to a button
 * press: it edits the message the button was on, which is how the buttons disappear and become
 * "✅ Approved by …".
 *
 * Node runtime: Ed25519 verification and the vault are `node:crypto`.
 */
export const runtime = "nodejs";

/** Interaction types. 1 is Discord's own health check, 3 is a message component (our buttons). */
const PING = 1;
const MESSAGE_COMPONENT = 3;

/** Callback types: 1 PONG, 4 CHANNEL_MESSAGE_WITH_SOURCE, 7 UPDATE_MESSAGE. */
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const UPDATE_MESSAGE = 7;

/** `MessageFlags.EPHEMERAL` — only the person who pressed sees it. */
const EPHEMERAL = 64;

type RouteContext = { params: Promise<{ connectionId: string }> };

/** The slice of an interaction this route reads; everything else is ignored. */
type DiscordUser = { username?: unknown; global_name?: unknown; id?: unknown };
type DiscordInteraction = {
  type?: unknown;
  data?: { custom_id?: unknown } | null;
  member?: { user?: DiscordUser } | null;
  user?: DiscordUser | null;
};

function fail(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

/** In a guild the presser is `member.user`; in a DM it is `user`. */
function pressedBy(interaction: DiscordInteraction): string {
  const user = interaction.member?.user ?? interaction.user ?? undefined;
  for (const value of [user?.global_name, user?.username, user?.id]) {
    if (typeof value === "string" && value) return value;
  }
  return "someone";
}

/** Replaces the message the buttons were on, so a decision cannot be pressed twice. */
function updateMessage(content: string): Response {
  return Response.json({ type: UPDATE_MESSAGE, data: { content, components: [] } });
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { connectionId } = await params;

  // Before anything else: these are the bytes Discord signed.
  const rawBody = await request.text();

  const connection = await loadConnection(connectionId, "discord-bot");
  if (!connection) return fail(404, "not_found", "No Discord app is listening at this URL.");

  const publicKey =
    typeof connection.meta.publicKey === "string" ? connection.meta.publicKey : "";
  if (!publicKey) {
    // Optional at connect time: the user connected the bot for posting and has not pasted the
    // public key from General Information yet.
    return fail(400, "no_public_key", "This Discord connection has no public key configured.");
  }

  const verified = verifyDiscord(
    rawBody,
    request.headers.get("x-signature-timestamp"),
    request.headers.get("x-signature-ed25519"),
    publicKey,
  );
  if (!verified) {
    // 401 exactly: Discord tests this endpoint with invalid signatures and drops the URL from the
    // application if one is accepted.
    console.warn(`discord: refused an interaction on ${connectionId}`);
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return fail(400, "bad_request", "This interaction was not JSON.");
  }

  if (interaction.type === PING) return Response.json({ type: PONG });

  if (interaction.type !== MESSAGE_COMPONENT) {
    return Response.json({
      type: CHANNEL_MESSAGE,
      data: { content: "Unsupported", flags: EPHEMERAL },
    });
  }

  const callback = parseApprovalCallback(interaction.data?.custom_id);
  if (!callback) {
    return Response.json({
      type: CHANNEL_MESSAGE,
      data: { content: "Unsupported", flags: EPHEMERAL },
    });
  }

  const by = pressedBy(interaction);

  try {
    const resumed = await resumeByStepId(
      callback.stepId,
      {
        approved: callback.approved,
        by,
        provider: "discord-bot",
        // `runGraph` follows a resumed payload's `handle` over the node's own.
        handle: callback.approved ? "approved" : "rejected",
      },
      connection.orgId,
    );

    // 200 either way — Discord shows a red "interaction failed" to the presser on anything else,
    // and "the run already moved on" is not their fault.
    if (!resumed.ok) {
      return updateMessage("This approval is no longer waiting — the run has already moved on.");
    }

    return updateMessage(callback.approved ? `✅ Approved by ${by}` : `❌ Rejected by ${by}`);
  } catch (cause) {
    console.error("discord: could not resume the run", cause);
    return fail(502, "resume_failed", "The run could not be resumed. Try again.");
  }
}
