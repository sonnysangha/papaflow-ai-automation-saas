import { resumeByToken } from "@/lib/hooks";

/**
 * `POST /api/wait/:token` — the Wait-for-webhook node's resume URL.
 *
 * The token is `${executionId}:${nodeId}`: it addresses exactly one node of one run, and it only
 * works while that node is `waiting`. That makes it a capability, like the Webhook trigger's secret
 * segment, so this route is deliberately public — no Clerk session, no org — and the proxy matcher
 * covers it unchanged (`clerkMiddleware()` protects nothing on its own).
 *
 * Unlike the provider event routes there is no signature to verify, because there is no provider:
 * whoever is being waited on may be a curl, a CI job or a person clicking a link.
 *
 * A token nobody is waiting on is a flat 404 — a caller must not be able to tell "wrong token"
 * from "that run already moved on".
 *
 * Node runtime: `resumeHook` and the engine client are Node-only.
 */
export const runtime = "nodejs";

/** Never copied into the payload: a step's output is stored and shown (CLAUDE.md rule 1). */
const DROPPED_HEADERS: ReadonlySet<string> = new Set(["authorization", "cookie"]);

type RouteContext = { params: Promise<{ token: string }> };

/** Lower-cased header names (HTTP is case-insensitive; templates are not), minus the secrets. */
function headersOf(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    // `x-clerk-*` are clerkMiddleware's internal proxy→route headers, not the caller's.
    if (!DROPPED_HEADERS.has(name) && !name.startsWith("x-clerk-")) headers[name] = value;
  });
  return headers;
}

/**
 * JSON when the caller said JSON, the raw text otherwise, `null` when there is no body at all.
 * A body that claims to be JSON but is not stays as text rather than failing the resume — the
 * workflow author can see exactly what arrived instead of a 400 they cannot debug.
 */
function parseBody(text: string, contentType: string): unknown {
  if (text.length === 0) return null;
  if (!contentType.toLowerCase().includes("json")) return text;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { token } = await params;

  // Raw text first, then parse — the same order the signed webhook routes use, so a signature
  // check can be dropped in front of this later without moving the body read (CLAUDE.md rule 6).
  const text = await request.text();
  const payload = {
    body: parseBody(text, request.headers.get("content-type") ?? ""),
    headers: headersOf(request),
  };

  try {
    const resumed = await resumeByToken(token, payload);
    if (!resumed.ok) {
      return Response.json({ error: "not_waiting" }, { status: resumed.status });
    }

    return Response.json({ resumed: true }, { status: 200 });
  } catch (cause) {
    console.error("wait: could not resume the run", cause);
    return Response.json({ error: "resume_failed" }, { status: 502 });
  }
}
