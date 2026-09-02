// Groq speaks the OpenAI models route under /openai/v1.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const groqConnector = defineConnector({
  provider: "groq",
  name: "Groq",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [{ name: "apiKey", label: "API key", kind: "secret", placeholder: "gsk_…" }],
  docsUrl: "https://console.groq.com/keys",
  icon: "Zap",
  test: (secret) => validateAndDiscover("groq", secret.apiKey),
});
