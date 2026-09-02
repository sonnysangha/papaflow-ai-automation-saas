// GET /v1/api-key validates (and reports blocked keys) before the model list is read.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const xaiConnector = defineConnector({
  provider: "xai",
  name: "xAI",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [{ name: "apiKey", label: "API key", kind: "secret", placeholder: "xai-…" }],
  docsUrl: "https://console.x.ai",
  icon: "Sparkles",
  test: (secret) => validateAndDiscover("xai", secret.apiKey),
});
