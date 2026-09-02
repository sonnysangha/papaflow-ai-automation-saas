import { z } from "zod";

import { isTokenKind, tokenFieldName } from "@/connectors/define";
import { CONNECTORS } from "@/connectors/registry";
import { ConnectorError, defineNode } from "../define";

/**
 * The escape hatch: any HTTP API, with or without one of the org's connections behind it.
 *
 * `credential: "any"` is the unusual part. Every other node names the provider it talks to, but
 * this one talks to whatever URL you type, so it accepts any connection that holds a single token
 * (`apiKey` or `botToken`) and sends it the way the API expects — `Authorization: Bearer …` for
 * most, a named header for the rest. The connection is optional (`credentialOptional`): without
 * one the node is exactly the unauthenticated request it has always been.
 *
 * The token exists only inside `run`. It is injected into the request headers, which are never
 * returned (the output carries the *response* headers) and never named in an error message —
 * `steps.input` only ever holds the `connectionId` (CLAUDE.md rule 1).
 */

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The token a connection carries, whatever its provider calls it.
 *
 * `credential` arrives as `{ provider, kind, meta?, ...secret }` (run-node's `openCredential`), so
 * the secret's field names are the connector's own and the connector definition is what knows
 * which of them is the credential. A connection that is not a single token — a Discord webhook
 * URL, a Stripe signing secret — is a configuration mistake, so it is a 4xx: `runNode` maps it to
 * a `FatalError` and the run stops instead of retrying its way to the same refusal.
 */
function tokenFrom(credential: Record<string, unknown>): string {
  const kind = typeof credential.kind === "string" ? credential.kind : "";
  if (!isTokenKind(kind)) {
    throw new ConnectorError(
      `This connection holds a ${kind || "credential"} rather than a token, so it cannot ` +
        "authenticate a request. Choose an API key or bot token connection, or set auth to none.",
      400,
    );
  }

  const provider = typeof credential.provider === "string" ? credential.provider : "";
  const field = tokenFieldName(CONNECTORS[provider]);
  if (!field) {
    throw new ConnectorError(
      `PapaFlow cannot tell which part of a ${provider || "this"} connection is its token. ` +
        "Set auth to none and add the header yourself.",
      400,
    );
  }

  const token = credential[field];
  if (typeof token !== "string" || !token) {
    throw new ConnectorError("This connection has no token — reconnect it.", 400);
  }
  return token;
}

/**
 * The request headers, with the connection's token added when one was chosen.
 *
 * A header the user typed by hand under the same name is dropped rather than sent alongside: two
 * `Authorization` headers is a 400 from most APIs and an ambiguity in the rest.
 */
function requestHeaders(
  inputs: { headers: Record<string, string>; auth: "bearer" | "header" | "none"; authHeader: string },
  credential: Record<string, unknown> | undefined,
): Record<string, string> {
  const headers = { ...inputs.headers };
  if (!credential || inputs.auth === "none") return headers;

  const name = inputs.auth === "bearer" ? "Authorization" : inputs.authHeader.trim();
  if (!name) {
    throw new ConnectorError("Name the header the token should be sent in.", 400);
  }

  const token = tokenFrom(credential);
  for (const existing of Object.keys(headers)) {
    if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
  }
  headers[name] = inputs.auth === "bearer" ? `Bearer ${token}` : token;
  return headers;
}

export const httpRequest = defineNode({
  type: "http.request",
  name: "HTTP Request",
  description: "Call any HTTP API and return its status, headers and body.",
  category: "action",
  icon: "Globe",
  // Any connection holding a single token will do, and none at all is fine too.
  credential: "any",
  credentialOptional: true,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string().optional().describe("Optional: authenticate with one of your connections"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.url(),
    auth: z
      .enum(["bearer", "header", "none"])
      .default("bearer")
      .describe("How the connection's token is sent. Ignored without a connection")
      .meta({ label: "Authentication" }),
    authHeader: z.string().default("Authorization").describe("Header name, when auth is header"),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().optional().describe("Raw body; JSON is sent as-is"),
  }),
  outputs: z.object({
    status: z.number(),
    headers: z.record(z.string(), z.string()),
    body: z.any(),
  }),
  async run({ inputs, credential }) {
    const response = await fetch(inputs.url, {
      method: inputs.method,
      headers: requestHeaders(inputs, credential),
      body: inputs.method === "GET" ? undefined : inputs.body,
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? parseJson(text) : text;

    if (response.status >= 400) {
      // The service's own words and the URL that was called — never the request headers, which is
      // where the token is.
      throw new ConnectorError(
        text || `HTTP ${response.status} from ${inputs.url}`,
        response.status,
        response.headers.get("retry-after") ?? undefined,
      );
    }

    return { status: response.status, headers: headersToRecord(response.headers), body };
  },
});
