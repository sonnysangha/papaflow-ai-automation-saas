import { z } from "zod";

import { GITHUB_API, githubHeaders, parseRepo } from "@/connectors/github";
import { ConnectorError, defineNode } from "../define";

/**
 * An issue in the repository the connection was made for. The repo is not a node input: a
 * fine-grained token is already scoped to a set of repositories, and the connection names the one
 * it writes to, so a workflow cannot quietly file issues somewhere else.
 *
 * GitHub's secondary rate limit (80 content-creating requests a minute) answers with **403 or
 * 429** plus a `Retry-After` — a 403 that carries that header is a wait, not a permission problem,
 * so it is mapped onto the retryable branch (docs/research/connectors-data.md).
 */

function credentialFrom(credential: Record<string, unknown> | undefined): {
  token: string;
  repo: string;
} {
  const token = credential?.token;
  const repo = credential?.repo;
  if (typeof token !== "string" || !token || typeof repo !== "string" || !repo) {
    throw new ConnectorError("This node needs a GitHub connection", 400);
  }
  return { token, repo };
}

export const githubCreateIssueNode = defineNode({
  type: "github.createIssue",
  name: "GitHub: Create issue",
  description: "Open an issue in the connection's repository.",
  category: "data",
  icon: "CircleDot",
  credential: "github",
  requiresFeature: null,
  version: "v1",
  inputs: z.object({
    connectionId: z.string(),
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).default([]),
  }),
  outputs: z.object({ number: z.number(), url: z.string() }),
  async run({ inputs, credential }) {
    const { token, repo } = credentialFrom(credential);
    const parsed = parseRepo(repo);
    if (!parsed) {
      throw new ConnectorError(`This connection's repository is not owner/repo: ${repo}`, 400);
    }

    const response = await fetch(`${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/issues`, {
      method: "POST",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: inputs.title,
        ...(inputs.body ? { body: inputs.body } : {}),
        ...(inputs.labels.length > 0 ? { labels: inputs.labels } : {}),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      // A 403 with a Retry-After is the secondary rate limit; a 403 without one is a real refusal.
      const throttled = response.status === 429 || (response.status === 403 && retryAfter !== null);
      throw new ConnectorError(
        text || `GitHub returned ${response.status}`,
        throttled ? 429 : response.status,
        throttled ? (retryAfter ?? "60s") : undefined,
      );
    }

    let issue: { number?: unknown; html_url?: unknown };
    try {
      issue = JSON.parse(text) as typeof issue;
    } catch {
      throw new ConnectorError(`GitHub returned a body that is not JSON: ${text.slice(0, 200)}`, 502);
    }

    if (typeof issue.number !== "number") {
      throw new ConnectorError(`GitHub created no issue: ${text.slice(0, 200)}`, 502);
    }

    return {
      number: issue.number,
      url: typeof issue.html_url === "string" ? issue.html_url : "",
    };
  },
});
