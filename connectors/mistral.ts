// Bearer key; the model list is filtered to models that can do chat completion.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const mistralConnector = defineConnector({
  provider: "mistral",
  name: "Mistral",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [{ name: "apiKey", label: "API key", kind: "secret", placeholder: "Your Mistral API key" }],
  docsUrl: "https://console.mistral.ai/api-keys",
  icon: "Sparkles",
  test: (secret) => validateAndDiscover("mistral", secret.apiKey),
});
