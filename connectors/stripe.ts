// Stripe is the one connector with nothing to call: a webhook signing secret (`whsec_…`) is not an
// API key, so there is no endpoint that will tell us whether it is right. The user creates the
// event destination in their own dashboard, pastes our per-connection URL into it, and copies the
// secret back (docs/research/connectors-data.md).
//
// The first delivery that verifies is therefore the real test — the inbound route flips
// `meta.verified` to true — and until then the connection honestly says it is unverified.
import { defineConnector } from "./define";

export const stripeConnector = defineConnector({
  provider: "stripe",
  name: "Stripe",
  category: "payments",
  kind: "signingSecret",
  requiresFeature: null,
  fields: [
    {
      name: "signingSecret",
      label: "Signing secret",
      kind: "secret",
      placeholder: "whsec_…",
      help: "From the Stripe webhook endpoint you point at PapaFlow",
    },
  ],
  docsUrl: "https://dashboard.stripe.com/webhooks",
  icon: "CreditCard",

  /** Shape-checks the paste and stops there: no request can prove a signing secret is correct. */
  async test(secret) {
    const signingSecret = secret.signingSecret?.trim();
    if (!signingSecret) {
      return { ok: false, error: "Paste the signing secret (whsec_…) from your Stripe webhook endpoint." };
    }

    return {
      ok: true,
      label: "Stripe webhook",
      hint: signingSecret.slice(-4),
      meta: { verified: false },
    };
  },

  /** The URL to paste into Stripe. It contains the connection id, so it only exists from here on. */
  async afterCreate({ connectionId, appOrigin }) {
    return { meta: { inboundUrl: `${appOrigin}/api/events/stripe/${connectionId}` } };
  },
});
