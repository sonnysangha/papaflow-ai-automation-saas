// fal has no authenticated list endpoint, so a one-image flux/schnell run is the test.
import { validateAndDiscover } from "@/lib/ai/validate";
import { defineConnector } from "./define";

export const falConnector = defineConnector({
  provider: "fal",
  name: "fal.ai",
  category: "ai",
  kind: "apiKey",
  requiresFeature: null,
  fields: [
    {
      name: "apiKey",
      label: "API key",
      kind: "secret",
      placeholder: "Your fal API key",
      help: "A key from fal.ai → Dashboard → Keys, in the form <key-id>:<key-secret>. Paste both halves including the colon.",
    },
  ],
  docsUrl: "https://fal.ai/dashboard/keys",
  icon: "Image",
  test: (secret) => validateAndDiscover("fal", secret.apiKey),
});
