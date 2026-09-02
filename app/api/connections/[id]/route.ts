import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import {
  connectionErrorResponse,
  refreshConnectionMeta,
  removeConnection,
  retestConnection,
} from "@/lib/connections-server";

/**
 * `DELETE /api/connections/:id` and `POST /api/connections/:id` with `{ action }`.
 *
 * Both take the id straight off the URL and neither trusts it: the org check happens against the
 * stored row's own `orgId`, and a connection belonging to another organisation answers `not_found`
 * exactly like one that never existed. Re-testing opens the sealed secret server-side; the response
 * only ever carries the verdict.
 *
 * Node runtime, not Edge: opening a credential is `node:crypto`.
 */
export const runtime = "nodejs";

const actionBody = z.object({ action: z.enum(["retest", "refresh"]) });

type RouteContext = { params: Promise<{ id: string }> };

/** Signed in, with an organisation selected. Ownership is organisational (CLAUDE.md rule 12). */
async function requireOrg(): Promise<{ orgId: string } | Response> {
  const { isAuthenticated, orgId } = await auth();
  if (!isAuthenticated || !orgId) {
    return Response.json(
      { code: "unauthorized", error: "Sign in and select an organisation first." },
      { status: 401 },
    );
  }
  return { orgId };
}

export async function DELETE(_request: Request, { params }: RouteContext): Promise<Response> {
  const authorized = await requireOrg();
  if (authorized instanceof Response) return authorized;

  const { id } = await params;
  try {
    await removeConnection({ connectionId: id, orgId: authorized.orgId });
    return Response.json({ ok: true });
  } catch (cause) {
    const { status, body } = connectionErrorResponse(cause);
    return Response.json(body, { status });
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const authorized = await requireOrg();
  if (authorized instanceof Response) return authorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "invalid_body", error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = actionBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "invalid_body", error: 'action must be "retest" or "refresh".' },
      { status: 400 },
    );
  }

  const { id } = await params;
  const args = { connectionId: id, orgId: authorized.orgId };

  try {
    // A failed test is not an HTTP failure: the row was updated to `needs_reconnect` and the
    // verdict is the payload the connections page renders.
    const result =
      parsed.data.action === "retest"
        ? await retestConnection(args)
        : await refreshConnectionMeta(args);
    return Response.json(result);
  } catch (cause) {
    const { status, body: payload } = connectionErrorResponse(cause);
    return Response.json(payload, { status });
  }
}
