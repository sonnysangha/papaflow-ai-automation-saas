import { describe, expect, it } from "vitest";

import {
  acceptsConnection,
  connectionNeed,
  credentialLabel,
  hasConnectionFor,
  providersFor,
  resolveAddTarget,
  type ConnectionLike,
} from "@/lib/connection-match";
import { NODES } from "@/nodes/registry";

function connection(over: Partial<ConnectionLike> = {}): ConnectionLike {
  return { provider: "openai", kind: "apiKey", status: "active", ...over };
}

describe("providersFor", () => {
  it("answers a family, a category and one provider differently", () => {
    expect(providersFor("slack")).toEqual(["slack"]);
    expect(providersFor("ai")).toContain("openai");
    expect(providersFor("ai")).toContain("anthropic");
    expect(providersFor("ai")).not.toContain("slack");
    // `chat` is the apps that can render a button a person presses back — not every chat connector.
    expect(providersFor("chat")).toEqual(["slack", "discord-bot", "telegram"]);
    expect(providersFor("discord").sort()).toEqual(["discord-bot", "discord-webhook"]);
  });
});

describe("acceptsConnection", () => {
  it("takes any single token for `any`, and nothing that is not one", () => {
    const accepts = acceptsConnection("any");
    expect(accepts(connection())).toBe(true);
    expect(accepts(connection({ provider: "telegram", kind: "botToken" }))).toBe(true);
    // A webhook URL is not a token to send as a header, so the HTTP node must not offer it.
    expect(accepts(connection({ provider: "discord-webhook", kind: "webhookUrl" }))).toBe(false);
    expect(accepts(connection({ provider: "stripe", kind: "signingSecret" }))).toBe(false);
  });

  it("matches a family by either of its providers", () => {
    const accepts = acceptsConnection("discord");
    expect(accepts(connection({ provider: "discord-webhook", kind: "webhookUrl" }))).toBe(true);
    expect(accepts(connection({ provider: "discord-bot", kind: "botToken" }))).toBe(true);
    expect(accepts(connection({ provider: "slack" }))).toBe(false);
  });
});

describe("hasConnectionFor", () => {
  it("counts active connections only", () => {
    expect(hasConnectionFor("ai", [connection()])).toBe(true);
    // A key that needs reconnecting would fail mid-run, so it does not make the node ready.
    expect(hasConnectionFor("ai", [connection({ status: "needs_reconnect" })])).toBe(false);
    expect(hasConnectionFor("ai", [connection({ status: "revoked" })])).toBe(false);
    expect(hasConnectionFor("slack", [connection()])).toBe(false);
  });
});

describe("connectionNeed", () => {
  it("says nothing about a node that needs no credential", () => {
    expect(connectionNeed({ credential: null, connections: [] })).toBeNull();
  });

  it("says nothing about a node that runs fine without one", () => {
    // The HTTP node sends an unauthenticated request; Send email falls back to the platform key.
    expect(
      connectionNeed({ credential: "any", credentialOptional: true, connections: [] }),
    ).toBeNull();
  });

  it("dims nothing while the connections are still loading", () => {
    expect(connectionNeed({ credential: "slack", connections: undefined })).toBeNull();
  });

  it("names the app and links to the form that adds it", () => {
    const need = connectionNeed({ credential: "slack", connections: [connection()] });
    expect(need).toEqual({
      credential: "slack",
      label: "Slack",
      href: "/connections?add=slack",
    });
  });

  it("stops asking once the org has one", () => {
    expect(
      connectionNeed({ credential: "slack", connections: [connection({ provider: "slack" })] }),
    ).toBeNull();
  });

  it("is answered by any member of a family or category", () => {
    expect(
      connectionNeed({ credential: "ai", connections: [connection({ provider: "anthropic" })] }),
    ).toBeNull();
    expect(
      connectionNeed({
        credential: "discord",
        connections: [connection({ provider: "discord-webhook", kind: "webhookUrl" })],
      }),
    ).toBeNull();
  });

  it("covers every credential the registry actually uses", () => {
    // A node whose credential the palette cannot name would render "Connect undefined".
    for (const definition of Object.values(NODES)) {
      if (!definition.credential) continue;
      const need = connectionNeed({
        credential: definition.credential,
        credentialOptional: definition.credentialOptional,
        connections: [],
      });
      if (definition.credentialOptional) {
        expect(need).toBeNull();
        continue;
      }
      expect(need?.label).toBeTruthy();
      expect(need?.label).not.toContain("undefined");
    }
  });
});

describe("credentialLabel", () => {
  it("reads as the words after “Connect”", () => {
    expect(credentialLabel("slack")).toBe("Slack");
    expect(credentialLabel("ai")).toBe("an AI provider");
    expect(credentialLabel("chat")).toBe("a chat app");
    expect(credentialLabel("discord")).toBe("Discord");
  });
});

describe("resolveAddTarget", () => {
  it("skips straight to a provider's own form", () => {
    expect(resolveAddTarget("slack")).toEqual({ provider: "slack" });
  });

  it("filters the picker to a family's category", () => {
    expect(resolveAddTarget("ai")).toEqual({ category: "ai" });
    expect(resolveAddTarget("chat")).toEqual({ category: "chat" });
    // Both ways of connecting Discord are chat connectors, so the picker can still be narrowed.
    expect(resolveAddTarget("discord")).toEqual({ category: "chat" });
  });

  it("opens the full list rather than nothing for a credential that is neither", () => {
    expect(resolveAddTarget("any")).toEqual({});
  });

  it("ignores a missing param", () => {
    expect(resolveAddTarget(null)).toBeNull();
    expect(resolveAddTarget("")).toBeNull();
  });
});
