// GET /api/v1/key validates and reports the remaining credit limit.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const openrouterConnector = defineConnector({
  provider: "openrouter",
  name: "OpenRouter",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "sk-or-v1-…",
      help: "An API key from openrouter.ai → Settings → Keys, starting sk-or-v1-. Not a provisioning key.",
    },
  ],
  docsUrl: "https://openrouter.ai/settings/keys",
  icon: "Route",
  test: (secret) => validateAndDiscover("openrouter", secret.apiKey),
});
