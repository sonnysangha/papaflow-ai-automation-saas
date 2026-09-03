import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionCard } from "@/components/connections/ConnectionList";
import {
  connectionRowView,
  inboundFor,
  modelCount,
  noticeFor,
  type ConnectionRowData,
} from "@/components/connections/connection-list";

/**
 * The connections list, in the two halves that can be checked without a browser: what a row works
 * out about a stored connection, and the markup of the phone card that replaces the table below
 * `md`. Both layouts render `connectionRowView`, so the card is asserted against the same strings
 * the table cells carry.
 */

const NOW = Date.now();

function connection(overrides: Partial<ConnectionRowData> = {}): ConnectionRowData {
  return {
    _id: "cn_1",
    provider: "openai",
    label: "OpenAI (work)",
    hint: "9f2a",
    status: "active",
    meta: {},
    updatedAt: NOW - 2 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe("modelCount", () => {
  it("counts a model list and refuses to guess at anything else", () => {
    expect(modelCount({ models: ["gpt-5", "gpt-5-mini"] })).toBe(2);
    expect(modelCount({ models: [] })).toBe(0);
    expect(modelCount({ models: "lots" })).toBeNull();
    expect(modelCount({})).toBeNull();
    expect(modelCount(null)).toBeNull();
    expect(modelCount("nope")).toBeNull();
  });
});

describe("inboundFor", () => {
  it("has nothing to offer a plain API key", () => {
    expect(inboundFor(connection())).toBeNull();
  });

  it("uses the URL the connector registered, and says whether Telegram accepted it", () => {
    const url = "https://papaflow.test/api/events/telegram/cn_1";

    expect(inboundFor(connection({ provider: "telegram", meta: { inboundUrl: url } }))).toEqual({
      url,
      hint: "Telegram webhook registered",
    });

    const unset = inboundFor(
      connection({ provider: "telegram", meta: { inboundUrl: url, webhookSet: false } }),
    );
    expect(unset?.url).toBe(url);
    expect(unset?.hint).toContain("only accepts https");
  });

  it("tells Stripe's owner where to paste it", () => {
    const url = "https://papaflow.test/api/events/stripe/cn_1";
    expect(inboundFor(connection({ provider: "stripe", meta: { inboundUrl: url } }))?.hint).toContain(
      "Stripe",
    );
  });

  it("derives the URLs nothing registers, from the id the row already has", () => {
    // No `NEXT_PUBLIC_APP_ORIGIN` and no `window` under vitest, so the origin is the empty string
    // and only the path is asserted — which is the part this function decides.
    expect(inboundFor(connection({ provider: "slack" }))?.url).toContain("/api/events/slack");
    expect(inboundFor(connection({ provider: "discord-bot" }))?.url).toContain(
      "/api/events/discord/cn_1",
    );
  });
});

describe("noticeFor", () => {
  it("warns a Resend account with no verified domain, and only that one", () => {
    expect(noticeFor(connection())).toBeNull();
    expect(noticeFor(connection({ provider: "resend", meta: {} }))).toContain(
      "onboarding@resend.dev",
    );
    expect(
      noticeFor(
        connection({
          provider: "resend",
          meta: { domains: [{ name: "papaflow.test", status: "verified" }] },
        }),
      ),
    ).toBeNull();
  });
});

describe("connectionRowView", () => {
  it("names the app behind a stored provider and masks the key", () => {
    const view = connectionRowView(connection({ meta: { models: ["gpt-5"] } }));

    expect(view.name).toBe("OpenAI");
    expect(view.isAi).toBe(true);
    expect(view.maskedKey).toBe("••••9f2a");
    expect(view.models).toBe(1);
    expect(view.statusLabel).toBe("Active");
    expect(view.menuLabel).toBe("Actions for OpenAI (work)");
  });

  it("falls back to the stored provider id when the catalogue has never heard of it", () => {
    const view = connectionRowView(connection({ provider: "wat" }));

    expect(view.name).toBe("wat");
    expect(view.isAi).toBe(false);
    expect(view.models).toBeNull();
  });

  it("labels the two states that want attention", () => {
    expect(connectionRowView(connection({ status: "needs_reconnect" })).statusLabel).toBe(
      "Needs reconnect",
    );
    expect(connectionRowView(connection({ status: "revoked" })).statusLabel).toBe("Revoked");
  });
});

describe("ConnectionCard", () => {
  const render = (row: ConnectionRowData) =>
    renderToStaticMarkup(
      <ConnectionCard
        connection={row as never}
        view={connectionRowView(row)}
        busy={false}
        onRetest={() => {}}
        onRefresh={() => {}}
        onDelete={() => {}}
      />,
    );

  it("shows the app, the label, the masked key, the status and the model count", () => {
    const html = render(connection({ meta: { models: ["a", "b", "c"] } }));

    expect(html).toContain("OpenAI");
    expect(html).toContain("OpenAI (work)");
    expect(html).toContain("••••9f2a");
    expect(html).toContain("Active");
    expect(html).toContain("3 models");
    expect(html).toContain("Actions for OpenAI (work)");
    expect(html).toContain("updated 2 hours ago");
  });

  it("keeps the inbound URL on the card rather than in a column that scrolls off a phone", () => {
    const html = render(connection({ provider: "discord-bot", label: "Guild bot" }));

    expect(html).toContain("/api/events/discord/cn_1");
    expect(html).toContain("Interactions Endpoint URL");
    expect(html).toContain("Copy the inbound URL for Guild bot");
  });

  it("carries the standing caveat a Resend key comes with", () => {
    const html = render(connection({ provider: "resend", label: "Resend", meta: {} }));

    expect(html).toContain("Without a verified domain");
  });

  it("singularises one model, and says nothing at all for a connector without any", () => {
    expect(render(connection({ meta: { models: ["only"] } }))).toContain("1 model<");
    expect(render(connection({ provider: "telegram" }))).not.toContain("model");
  });
});
