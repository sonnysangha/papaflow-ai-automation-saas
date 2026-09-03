// The credential mistakes that look like a working key but can never authenticate, caught before
// the key is sent anywhere.
//
// Every one of these otherwise arrives as a bare `401 invalid x-api-key` from the provider, which
// tells the person nothing about what they actually pasted. Prefixes are quoted from each
// provider's own documentation; anything not listed here is left to the provider to judge, because
// guessing at key formats is how a valid key gets refused by its own app.

/** Anthropic's Admin API key — the Admin API only, never `/v1/messages` or `/v1/models`. */
const ANTHROPIC_ADMIN = "sk-ant-admin";
/** The OAuth access token Claude Code holds. Not an API key, and not accepted by `x-api-key`. */
const ANTHROPIC_OAUTH = "sk-ant-oat";
/** Every Anthropic API key: `sk-ant-api…` (docs: "Static `sk-ant-api...` secret"). */
const ANTHROPIC_API = "sk-ant-";

/**
 * What is wrong with the *shape* of this key, in the user's terms — or null to let the provider
 * decide, which is the answer for anything this file is not certain about.
 */
export function keyShapeProblem(provider: string, apiKey: string): string | null {
  const key = apiKey.trim();
  if (key.length === 0) return null;

  if (provider === "anthropic") {
    if (key.startsWith(ANTHROPIC_ADMIN)) {
      return "That is an Anthropic Admin API key (sk-ant-admin…). It only works with the Admin API, which manages members and workspaces. Create a standard key under Settings → API keys and paste that instead.";
    }
    if (key.startsWith(ANTHROPIC_OAUTH)) {
      return "That is a Claude Code OAuth token (sk-ant-oat…), not an API key. Create a key under Settings → API keys at console.anthropic.com and paste that instead.";
    }
    if (!key.startsWith(ANTHROPIC_API)) {
      return key.startsWith("sk-")
        ? "That looks like a key for another provider. An Anthropic API key starts sk-ant-."
        : "An Anthropic API key starts sk-ant-. Copy it from Settings → API keys at console.anthropic.com.";
    }
    return null;
  }

  // The reverse mistake: an Anthropic key pasted into any of the providers that never issue one.
  if (key.startsWith(ANTHROPIC_API) && provider !== "anthropic") {
    return `That is an Anthropic API key (sk-ant-…), not a ${providerLabel(provider)} one.`;
  }

  if (provider === "google" && key.startsWith("sk-")) {
    return "That looks like an OpenAI or Anthropic key. A Google AI Studio key starts AIza.";
  }

  return null;
}

/** Only for the sentence above; the connector files own the display names users normally see. */
function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
