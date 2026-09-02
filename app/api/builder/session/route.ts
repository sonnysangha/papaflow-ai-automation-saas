import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import {
  attachEveSession,
  builderErrorMessage,
  getBuilderWorkflow,
  startBuilderSession,
} from "@/lib/builder-engine";
import { BUILDER_FEATURE } from "@/lib/builder-protocol";

/**
 * `POST /api/builder/session` — opens (or reuses) this user's Builder chat for one workflow.
 * `PATCH` — records the eve session id once the panel's first turn has been accepted.
 *
 * Layer two of the plan gate (CLAUDE.md rule 3): `<Show>` hides the button in the UI, this route
 * refuses with `has()`, and every Builder tool checks the plan again inside `execute`. Only the
 * last two are enforcement — the first is decoration.
 *
 * The route does not open the eve session itself. The panel does that with `useEveAgent`, over the
 * same origin, with the user's own Clerk token: eve's session routes are the agent's, not ours, and
 * proxying them here would mean minting a token for the browser or forwarding the user's. What this
 * route *is* for is the two things the panel cannot do safely on its own — proving the plan and the
 * workflow's ownership before a session exists, and writing the `builderSessions` row.
 *
 * Node runtime: `lib/builder-engine.ts` talks to Convex with `ENGINE_SECRET`.
 */
export const runtime = "nodejs";

const openBody = z.object({ workflowId: z.string().min(1) });

const attachBody = z.object({
  builderSessionId: z.string().min(1),
  eveSessionId: z.string().min(1),
});

type Session = { userId: string; orgId: string };

/** 401 unless there is a signed-in user with an active organisation, 403 unless the plan pays. */
async function gate(): Promise<{ session: Session } | { response: Response }> {
  const { isAuthenticated, orgId, userId, has } = await auth();

  if (!isAuthenticated || !orgId || !userId) {
    return {
      response: Response.json(
        { code: "unauthorized", error: "Sign in and select an organisation first." },
        { status: 401 },
      ),
    };
  }

  // The explicit `org:` prefix is required by Clerk Core 3 (CLAUDE.md rule 10).
  if (!has({ feature: `org:${BUILDER_FEATURE}` })) {
    return {
      response: Response.json(
        {
          code: "upgrade_required",
          feature: BUILDER_FEATURE,
          error: "The AI builder is a Pro feature.",
        },
        { status: 403 },
      ),
    };
  }

  return { session: { userId, orgId } };
}

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ code: "invalid_body", error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      {
        code: "invalid_body",
        error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "),
      },
      { status: 400 },
    );
  }
  return parsed.data;
}

export async function POST(request: Request): Promise<Response> {
  const gated = await gate();
  if ("response" in gated) return gated.response;
  const { orgId, userId } = gated.session;

  const parsed = await body(request, openBody);
  if (parsed instanceof Response) return parsed;

  try {
    // The workflow is proved to be this organisation's *here*, before a chat exists, so a session
    // is never opened against an id the user cannot edit. Every tool re-checks it anyway.
    const workflow = await getBuilderWorkflow(parsed.workflowId, orgId);
    if (!workflow) {
      return Response.json({ code: "not_found", error: "No such workflow." }, { status: 404 });
    }

    const session = await startBuilderSession({ workflowId: parsed.workflowId, orgId, userId });
    return Response.json(
      {
        builderSessionId: session.builderSessionId,
        // Empty until the panel reports one; a reload resumes the chat from it.
        eveSessionId: session.eveSessionId,
        workflow: { name: workflow.name, version: workflow.version, status: workflow.status },
      },
      { status: 200 },
    );
  } catch (cause) {
    console.error("builder/session: could not open a session", cause);
    return Response.json(
      { code: "server_error", error: builderErrorMessage(cause) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const gated = await gate();
  if ("response" in gated) return gated.response;
  const { orgId, userId } = gated.session;

  const parsed = await body(request, attachBody);
  if (parsed instanceof Response) return parsed;

  try {
    await attachEveSession({ ...parsed, orgId, userId });
    return Response.json({ ok: true }, { status: 200 });
  } catch (cause) {
    console.error("builder/session: could not attach the eve session id", cause);
    return Response.json(
      { code: "server_error", error: builderErrorMessage(cause) },
      { status: 500 },
    );
  }
}
