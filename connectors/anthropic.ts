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
  ],
  docsUrl: "https://console.anthropic.com/settings/keys",
  icon: "Sparkles",
  test: (secret) => validateAndDiscover("anthropic", secret.apiKey),
});
