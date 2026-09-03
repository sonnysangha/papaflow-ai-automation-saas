// Validated with x-api-key + anthropic-version on GET /v1/models?limit=1000.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const anthropicConnector = defineConnector({
  provider: "anthropic",
  name: "Anthropic",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "sk-ant-…",
      help: "An API key from console.anthropic.com → API keys, starting sk-ant-api03-. Admin keys and Claude Code tokens will not work.",
    },
    {
      // Anthropic's newer keys are identity-linked: one created for a person or a service account,
      // rather than bound to a single workspace, must name the workspace on every request or the
      // API answers 400. Blank is right for a workspace-scoped key, which is most of them.
      name: "workspaceId",
      label: "Workspace ID",
      kind: "text",
      required: false,
      placeholder: "wrkspc_… (only if the key is not tied to one workspace)",
      help: "Leave blank for a key created for a single workspace. A personal or service-account key that spans workspaces needs the id from console.anthropic.com → Settings → Workspaces.",
    },
  ],
  docsUrl: "https://console.anthropic.com/settings/keys",
  icon: "Sparkles",
  test: (secret) => validateAndDiscover("anthropic", secret.apiKey, { workspaceId: secret.workspaceId }),
});
