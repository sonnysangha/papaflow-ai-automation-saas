// A fine-grained personal access token plus the one repository it may write to. Two fields rather
// than one because a fine-grained PAT is already scoped to a set of repositories, and the node has
// to know which of them to file issues in — asking once, here, keeps `owner/repo` out of every
// node's configuration.
//
// GitHub rejects requests without a `User-Agent`, and the API version header is pinned explicitly:
// a request without it silently gets 2022-11-28 (docs/research/connectors-data.md).
import { defineConnector } from "./define";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";
export const GITHUB_USER_AGENT = "papaflow/0.1";

const TIMEOUT_MS = 15_000;

/** The headers every GitHub call needs. Exported so the node sends exactly the same set. */
export function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": GITHUB_USER_AGENT,
  };
}

/** `owner/repo`, rejected here rather than at the first 404 from the issues endpoint. */
export function parseRepo(value: string): { owner: string; repo: string } | null {
  const parts = value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts.map((part) => part.trim());
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function callGitHub(
  token: string,
  path: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not reach GitHub. Check your connection and try again." };
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & { message?: unknown };
  if (!response.ok) {
    if (response.status === 401) return { ok: false, error: "GitHub rejected that token." };
    const described = typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
    return { ok: false, error: `GitHub refused the request: ${described}` };
  }

  return { ok: true, data: payload };
}

export const githubConnector = defineConnector({
  provider: "github",
  name: "GitHub",
  category: "data",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "token",
      label: "Fine-grained token",
      kind: "secret",
      placeholder: "github_pat_…",
      help: "Repository permissions → Issues: Read and write",
    },
    {
      name: "repo",
      label: "Repository",
      kind: "text",
      placeholder: "owner/repo",
      help: "The repository this connection files issues in",
    },
  ],
  docsUrl: "https://github.com/settings/personal-access-tokens/new",
  icon: "GitBranch",

  /**
   * Two calls, because either can fail on its own: the token can be valid but not cover this
   * repository, which is the mistake a fine-grained PAT makes easiest to make.
   */
  async test(secret) {
    const token = secret.token?.trim();
    if (!token) return { ok: false, error: "Paste a fine-grained personal access token." };

    const parsed = parseRepo(secret.repo ?? "");
    if (!parsed) return { ok: false, error: "Write the repository as owner/repo." };

    const user = await callGitHub(token, "/user");
    if (!user.ok) return user;

    const login = typeof user.data.login === "string" ? user.data.login : "";
    if (!login) return { ok: false, error: "GitHub accepted the token but returned no user." };

    const repo = await callGitHub(token, `/repos/${parsed.owner}/${parsed.repo}`);
    if (!repo.ok) {
      return {
        ok: false,
        error: `${login} cannot reach ${parsed.owner}/${parsed.repo}. Check the token's repository access.`,
      };
    }

    const fullName = typeof repo.data.full_name === "string" ? repo.data.full_name : `${parsed.owner}/${parsed.repo}`;

    return {
      ok: true,
      label: `GitHub (${fullName})`,
      hint: token.slice(-4),
      meta: { login, repo: fullName },
    };
  },
});
