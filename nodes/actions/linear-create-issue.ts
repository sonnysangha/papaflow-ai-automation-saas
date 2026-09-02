import { z } from "zod";

import { LINEAR_API, linearHeaders } from "@/connectors/linear";
import { ConnectorError, defineNode } from "../define";

/**
 * An issue in a Linear team.
 *
 * Linear does not use HTTP 429. A throttled request comes back as **HTTP 400** carrying
 * `errors[].extensions.code === "RATELIMITED"`, so the retryable case has to be found in the body
 * rather than the status line — without this branch every rate limit would look like a
 * configuration mistake and never be retried (CLAUDE.md rule 7, docs/research/connectors-data.md).
 */

const CREATE_ISSUE = `mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}`;

/** Linear's own backoff hint when it throttles without a header. */
const LINEAR_BACKOFF = "60s";

type GraphQLError = { message?: unknown; extensions?: { code?: unknown } };

function apiKeyFrom(credential: Record<string, unknown> | undefined): string {
  const apiKey = credential?.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new ConnectorError("This node needs a Linear connection", 400);
  }
  return apiKey;
}

/** True when any GraphQL error in the response is the rate-limit one. */
export function isRateLimited(errors: readonly GraphQLError[]): boolean {
  return errors.some((error) => error.extensions?.code === "RATELIMITED");
}

function messageOf(errors: readonly GraphQLError[]): string {
  const first = errors.find((error) => typeof error.message === "string");
  return typeof first?.message === "string" ? first.message : "Linear refused the request";
}

export const linearCreateIssueNode = defineNode({
  type: "linear.createIssue",
  name: "Linear: Create issue",
  description: "File an issue in a Linear team.",
  category: "data",
  icon: "SquareKanban",
  credential: "linear",
  requiresFeature: "pro_connectors",
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    teamId: z.string().min(1).meta({ picker: "teams" }),
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  outputs: z.object({ id: z.string(), identifier: z.string(), url: z.string() }),
  async run({ inputs, credential }) {
    const response = await fetch(LINEAR_API, {
      method: "POST",
      // Bare key, no `Bearer`: that prefix is for OAuth tokens and a personal key sent with it 401s.
      headers: linearHeaders(apiKeyFrom(credential)),
      body: JSON.stringify({
        query: CREATE_ISSUE,
        variables: {
          input: {
            teamId: inputs.teamId,
            title: inputs.title,
            ...(inputs.description ? { description: inputs.description } : {}),
          },
        },
      }),
    });

    const text = await response.text();
    let payload: { data?: { issueCreate?: unknown }; errors?: GraphQLError[] };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new ConnectorError(text || `Linear returned ${response.status}`, response.status || 502);
    }

    const errors = payload.errors ?? [];
    if (errors.length > 0) {
      throw new ConnectorError(
        messageOf(errors),
        isRateLimited(errors) ? 429 : response.status >= 400 ? response.status : 400,
        isRateLimited(errors) ? (response.headers.get("retry-after") ?? LINEAR_BACKOFF) : undefined,
      );
    }

    if (!response.ok) {
      throw new ConnectorError(text || `Linear returned ${response.status}`, response.status);
    }

    const result = (payload.data?.issueCreate ?? {}) as {
      success?: unknown;
      issue?: { id?: unknown; identifier?: unknown; url?: unknown };
    };
    const issue = result.issue;
    if (result.success !== true || typeof issue?.id !== "string") {
      throw new ConnectorError(`Linear created no issue: ${text.slice(0, 200)}`, 502);
    }

    return {
      id: issue.id,
      identifier: typeof issue.identifier === "string" ? issue.identifier : "",
      url: typeof issue.url === "string" ? issue.url : "",
    };
  },
});
