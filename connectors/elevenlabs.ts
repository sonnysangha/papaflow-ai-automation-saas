// xi-api-key on GET /v1/user validates; the picker keeps text-to-speech models.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const elevenlabsConnector = defineConnector({
  provider: "elevenlabs",
  name: "ElevenLabs",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "Your ElevenLabs API key",
      help: "An API key from elevenlabs.io → Settings → API keys, starting sk_. It needs text-to-speech permission.",
    },
  ],
  docsUrl: "https://elevenlabs.io/app/settings/api-keys",
  icon: "Mic",
  test: (secret) => validateAndDiscover("elevenlabs", secret.apiKey),
});
