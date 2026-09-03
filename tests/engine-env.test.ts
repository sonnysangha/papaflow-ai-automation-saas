import { afterEach, describe, expect, it, vi } from "vitest";

import {
  convexUrl,
  engineEnv,
  engineSecret,
  EngineUnavailableError,
  isEngineUnavailable,
} from "@/lib/engine-env";

/**
 * Which variable the engine and the eve services find Convex under, and what they say when they
 * cannot.
 *
 * This is the whole of the production bug in one module: `NEXT_PUBLIC_CONVEX_URL` is injected into
 * the Next build by `convex deploy` and inlined into the Next bundle, so the eve services — separate
 * Vercel services sharing the project's environment variables — never see it. `CONVEX_URL` is the
 * project variable they do see, and it has to win when both are present (a Preview build inlines the
 * preview URL, and the services must agree with it).
 *
 * The messages are asserted verbatim because they are the operator-facing half of the fix: the line
 * in a function log, and the sentence the Builder shows the user.
 */

const URLS = ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL", "ENGINE_SECRET"] as const;

/** Every variable this module reads, explicitly unset, so the host's shell cannot change a result. */
function clearEnv() {
  for (const name of URLS) vi.stubEnv(name, undefined);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("convexUrl", () => {
  it("prefers CONVEX_URL — the project variable both eve services can actually see", () => {
    clearEnv();
    vi.stubEnv("CONVEX_URL", "https://content-albatross-126.convex.cloud");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://inlined-into-next.convex.cloud");

    expect(convexUrl()).toBe("https://content-albatross-126.convex.cloud");
  });

  it("falls back to NEXT_PUBLIC_CONVEX_URL, which is all local development has", () => {
    clearEnv();
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://fastidious-puffin-373.convex.cloud");

    expect(convexUrl()).toBe("https://fastidious-puffin-373.convex.cloud");
  });

  it("treats a variable set to nothing as unset, because Vercel keeps empty values", () => {
    clearEnv();
    vi.stubEnv("CONVEX_URL", "   ");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://fastidious-puffin-373.convex.cloud");

    expect(convexUrl()).toBe("https://fastidious-puffin-373.convex.cloud");
  });

  it("is undefined when neither is set", () => {
    clearEnv();
    expect(convexUrl()).toBeUndefined();
    expect(engineSecret()).toBeUndefined();
  });
});

describe("engineEnv", () => {
  it("hands back the URL and the shared secret when both are there", () => {
    clearEnv();
    vi.stubEnv("CONVEX_URL", "https://content-albatross-126.convex.cloud");
    vi.stubEnv("ENGINE_SECRET", "shared-secret");

    expect(engineEnv()).toEqual({
      url: "https://content-albatross-126.convex.cloud",
      secret: "shared-secret",
    });
  });

  it("names the URL pair, and only that, when the secret is present", () => {
    clearEnv();
    vi.stubEnv("ENGINE_SECRET", "shared-secret");

    expect(() => engineEnv()).toThrow("CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set");
    try {
      engineEnv();
    } catch (error) {
      expect((error as Error).message).not.toContain("ENGINE_SECRET");
    }
  });

  it("names ENGINE_SECRET, and only that, when the URL is present", () => {
    clearEnv();
    vi.stubEnv("CONVEX_URL", "https://content-albatross-126.convex.cloud");

    try {
      engineEnv();
      expect.unreachable("engineEnv should refuse without ENGINE_SECRET");
    } catch (error) {
      expect((error as Error).message).toBe("ENGINE_SECRET is not set");
    }
  });

  it("names both when a service was deployed with neither", () => {
    clearEnv();
    expect(() => engineEnv()).toThrow(
      "CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set and ENGINE_SECRET is not set",
    );
  });

  it("prefixes the caller, so a Vercel function log says which service is misconfigured", () => {
    clearEnv();
    vi.stubEnv("ENGINE_SECRET", "shared-secret");

    expect(() => engineEnv("builder-engine")).toThrow(
      "builder-engine: CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) is not set",
    );
  });

  it("refuses with a terminal error — a missing variable is not worth a retry", () => {
    clearEnv();
    try {
      engineEnv("connections-engine");
      expect.unreachable("engineEnv should refuse with nothing set");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineUnavailableError);
      expect(error).toMatchObject({
        name: "EngineUnavailableError",
        code: "service_unavailable",
        retryable: false,
      });
      expect(isEngineUnavailable(error)).toBe(true);
    }
  });

  it("never puts a value in the message, only variable names", () => {
    clearEnv();
    vi.stubEnv("CONVEX_URL", "https://content-albatross-126.convex.cloud");

    try {
      engineEnv();
    } catch (error) {
      expect((error as Error).message).not.toContain("content-albatross-126");
    }
  });
});

describe("isEngineUnavailable", () => {
  it("recognises the class", () => {
    expect(isEngineUnavailable(new EngineUnavailableError("CONVEX_URL is not set"))).toBe(true);
  });

  it("recognises an error that lost its class crossing a step boundary", () => {
    // The Workflow SDK hydrates a step's error before the workflow body catches it; `name` survives
    // the trip, the prototype does not.
    const hydrated = Object.assign(new Error("builder-engine: CONVEX_URL is not set"), {
      name: "EngineUnavailableError",
    });
    expect(isEngineUnavailable(hydrated)).toBe(true);
    expect(isEngineUnavailable({ code: "service_unavailable" })).toBe(true);
  });

  it("leaves an ordinary refusal alone — those are the model's to act on", () => {
    expect(isEngineUnavailable(new Error("There is no node type \"http.reqest\"."))).toBe(false);
    expect(isEngineUnavailable("nope")).toBe(false);
    expect(isEngineUnavailable(null)).toBe(false);
    expect(isEngineUnavailable(undefined)).toBe(false);
  });
});
