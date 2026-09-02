import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { connectionErrorResponse, createConnectionFromInput } from "@/lib/connections-server";

/**
 * `POST /api/connections` — the one place a raw credential enters the system.
 *
 * The body is the only thing in the app that carries a plaintext secret, and it stops here: the
 * connector tests it, `lib/vault.ts` seals it, and the response is `{ id, label }`. Nothing is
 * logged, echoed back or written anywhere unsealed (CLAUDE.md rule 1).
 *
 * Node runtime, not Edge: sealing is `node:crypto`.
 */
export const runtime = "nodejs";

const createBody = z.object({
  provider: z.string().min(1),
  label: z.string().max(200).optional(),
  /** The connector's form fields by name (`{ apiKey: "sk-…" }`). Values are never logged. */
  secret: z.record(z.string(), z.string()),
});

/** Field names and reasons only — zod does not put the offending value in its messages. */
function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

export async function POST(request: Request): Promise<Response> {
  const { isAuthenticated, orgId, userId, has } = await auth();
  if (!isAuthenticated || !orgId || !userId) {
    return Response.json(
      { code: "unauthorized", error: "Sign in and select an organisation first." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "invalid_body", error: "Expected a JSON body." },
      { status: 400 },
    );
  }

  const parsed = createBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { code: "invalid_body", error: issueSummary(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const created = await createConnectionFromInput({
      orgId,
      userId,
      provider: parsed.data.provider,
      label: parsed.data.label,
      secret: parsed.data.secret,
      has,
    });
    return Response.json(created, { status: 201 });
  } catch (cause) {
    const { status, body: payload } = connectionErrorResponse(cause);
    return Response.json(payload, { status });
  }
}
