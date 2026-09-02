import { z } from "zod";
import { ConnectorError, defineNode } from "../define";

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

export const httpRequest = defineNode({
  type: "http.request",
  name: "HTTP Request",
  description: "Call any HTTP API and return its status, headers and body.",
  category: "action",
  icon: "Globe",
  credential: null,
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.url(),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().optional().describe("Raw body; JSON is sent as-is"),
  }),
  outputs: z.object({
    status: z.number(),
    headers: z.record(z.string(), z.string()),
    body: z.any(),
  }),
  async run({ inputs }) {
    const response = await fetch(inputs.url, {
      method: inputs.method,
      headers: inputs.headers,
      body: inputs.method === "GET" ? undefined : inputs.body,
    });

    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? parseJson(text) : text;

    if (response.status >= 400) {
      throw new ConnectorError(
        text || `HTTP ${response.status} from ${inputs.url}`,
        response.status,
        response.headers.get("retry-after") ?? undefined,
      );
    }

    return { status: response.status, headers: headersToRecord(response.headers), body };
  },
});
