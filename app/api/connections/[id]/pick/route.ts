import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { connectionErrorResponse, pickConnectionOptions } from "@/lib/connections-server";

/**
 * `POST /api/connections/:id/pick` with `{ kind }` → `{ options: [{ id, label }] }`.
 *
 * The config panel's dropdowns (Slack channels, Discord guilds and channels, Telegram chats) are
 * lists only the provider knows, and only the credential can read. Rather than hand a token to the
 * browser, the browser names the list it wants and this route opens the sealed secret, calls the
 * provider and returns ids and labels — never the secret, and never the provider's raw response
 * (CLAUDE.md rule 1).
 *
 * The org check is the stored row's own `orgId`, exactly like the sibling route: another org's
 * connection answers `not_found`, indistinguishable from one that never existed.
 *
 * Node runtime, not Edge: opening a credential is `node:crypto`.
 */
export const runtime = "nodejs";

const pickBody = z.object({ kind: z.string().min(1).max(200) });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { isAuthenticated, orgId } = await auth();
  if (!isAuthenticated || !orgId) {
    return Response.json(
      { code: "unauthorized", error: "Sign in and select an organisation first." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_body", error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = pickBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "invalid_body", error: "kind must be a non-empty string." },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const options = await pickConnectionOptions({
      connectionId: id,
      orgId,
      kind: parsed.data.kind,
    });
    return Response.json({ options });
  } catch (cause) {
    const { status, body: payload } = connectionErrorResponse(cause);
    return Response.json(payload, { status });
  }
}
