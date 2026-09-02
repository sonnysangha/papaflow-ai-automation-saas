// DeepSeek's model list is unversioned: GET https://api.deepseek.com/models.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const deepseekConnector = defineConnector({
  provider: "deepseek",
  name: "DeepSeek",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [{ name: "apiKey", label: "API key", kind: "secret", placeholder: "sk-…" }],
  docsUrl: "https://platform.deepseek.com/api_keys",
  icon: "Sparkles",
  test: (secret) => validateAndDiscover("deepseek", secret.apiKey),
});
