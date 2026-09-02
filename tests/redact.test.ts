import { describe, expect, it } from "vitest";

import { REDACTED, redact } from "@/lib/redact";

describe("redact", () => {
  it("masks every key that looks like a credential", () => {
    const masked = redact({
      apiKey: "sk-live-123",
      api_key: "sk-live-123",
      "api-key": "sk-live-123",
      accessToken: "ya29.abc",
      clientSecret: "shh",
      password: "hunter2",
      Authorization: "Bearer abc",
      Cookie: "session=1",
    });

    expect(masked).toEqual({
      apiKey: REDACTED,
      api_key: REDACTED,
      "api-key": REDACTED,
      accessToken: REDACTED,
      clientSecret: REDACTED,
      password: REDACTED,
      Authorization: REDACTED,
      Cookie: REDACTED,
    });
  });

  it("leaves everything else untouched", () => {
    const inputs = {
      url: "https://api.example.com/v1/users?key=in-the-query",
      method: "POST",
      retries: 3,
      enabled: true,
      body: null,
      missing: undefined,
    };

    expect(redact(inputs)).toEqual(inputs);
  });

  it("masks deeply, through objects and arrays", () => {
    expect(
      redact({
        url: "https://api.example.com",
        headers: { Authorization: "Bearer abc", "content-type": "application/json" },
        connections: [
          { label: "Prod", secret: "sealed" },
          { label: "Dev", nested: { refresh_token: "rt_1", scopes: ["read"] } },
        ],
      }),
    ).toEqual({
      url: "https://api.example.com",
      headers: { Authorization: REDACTED, "content-type": "application/json" },
      connections: [
        { label: "Prod", secret: REDACTED },
        { label: "Dev", nested: { refresh_token: REDACTED, scopes: ["read"] } },
      ],
    });
  });

  it("keeps arrays as arrays, in order", () => {
    const masked = redact({ items: [1, 2, 3], tags: ["a", "b"] }) as {
      items: number[];
      tags: string[];
    };

    expect(Array.isArray(masked.items)).toBe(true);
    expect(masked.items).toEqual([1, 2, 3]);
    expect(masked.tags).toEqual(["a", "b"]);
  });

  it("masks a whole value, not just strings — a secret object never survives", () => {
    expect(redact({ token: { access: "a", refresh: "b" } })).toEqual({ token: REDACTED });
  });

  it("copies rather than mutates its argument", () => {
    const inputs = { headers: { Authorization: "Bearer abc" } };
    const masked = redact(inputs) as { headers: { Authorization: string } };

    expect(inputs.headers.Authorization).toBe("Bearer abc");
    expect(masked.headers).not.toBe(inputs.headers);
  });

  it("passes non-plain values through as they are", () => {
    const date = new Date("2026-09-02T00:00:00.000Z");
    const masked = redact({ scheduledAt: date, count: 1 }) as { scheduledAt: Date };

    expect(masked.scheduledAt).toBe(date);
    expect(redact("plain string")).toBe("plain string");
    expect(redact(null)).toBeNull();
  });
});
