// GET /v1/models with a bearer key both validates and lists (docs/research/ai-sdk.md).
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const openaiConnector = defineConnector({
  provider: "openai",
  name: "OpenAI",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "sk-…",
      help: "A secret key from platform.openai.com → API keys, starting sk- (project keys start sk-proj-). Not an organisation id or a session token.",
    },
  ],
  docsUrl: "https://platform.openai.com/api-keys",
  icon: "Sparkles",
  test: (secret) => validateAndDiscover("openai", secret.apiKey),
});
