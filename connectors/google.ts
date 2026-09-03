// An AI Studio key, validated with x-goog-api-key on the v1beta model list.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const googleConnector = defineConnector({
  provider: "google",
  name: "Google Gemini",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "AIza…",
      help: "A Gemini API key from aistudio.google.com → Get API key, starting AIza. Not a Google Cloud service-account JSON or an OAuth token.",
    },
  ],
  docsUrl: "https://aistudio.google.com/apikey",
  icon: "Sparkles",
  test: (secret) => validateAndDiscover("google", secret.apiKey),
});
