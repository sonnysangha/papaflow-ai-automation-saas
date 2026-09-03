import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { clearEnginePlanCache, orgPlanFromClerk } from "@/lib/billing-engine";
import {
  convexUrl,
  engineEnv,
  engineSecret,
  EngineUnavailableError,
  isEngineUnavailable,
  safeErrorMessage,
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

describe("the NEXT_PUBLIC fallback Next has to be able to inline", () => {
  /**
   * The one thing no runtime test can catch. `NEXT_PUBLIC_CONVEX_URL` is never a Vercel project
   * variable — `convex deploy --cmd-url-env-var-name` puts it in the *build* process, where Next
   * substitutes the literal text `process.env.NEXT_PUBLIC_CONVEX_URL` into the bundle
   * (`next/dist/lib/static-env.js`). A computed read (`process.env[name]`) is not substituted, so
   * the fallback would evaporate in every deployed build and `CONVEX_URL` would silently become
   * mandatory for every run, trigger and schedule. Under vitest both spellings pass, so the
   * spelling itself is the assertion.
   */
  const source = readFileSync(new URL("../lib/engine-env.ts", import.meta.url), "utf8");
  /** Comments explain the rule; the code has to keep it. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("reads the variable as a literal member expression", () => {
    expect(code).toContain("process.env.NEXT_PUBLIC_CONVEX_URL");
  });

  it("never reads the environment through a computed key", () => {
    expect(code).not.toMatch(/process\.env\[/);
  });
});

describe("safeErrorMessage", () => {
  /**
   * Everything that shows an engine failure to a person or a model goes through here: the Runtime
   * agent's log line, the Builder's tool result (which the model reads, quotes into the chat panel
   * and returns from a `"use step"` function the Workflow dashboard records). Convex answers an
   * argument-validation failure by echoing the arguments it refused, and every engine call passes
   * `secret` as one of them — CLAUDE.md rule 1.
   */
  it("masks the shared secret wherever it appears", () => {
    vi.stubEnv("ENGINE_SECRET", "shared-secret");

    const message = safeErrorMessage(
      new Error('ArgumentValidationError: { secret: "shared-secret", orgId: "org_1" }'),
    );

    expect(message).not.toContain("shared-secret");
    expect(message).toContain("••••");
    expect(message).toContain("org_1");
  });

  it("drops a secret-shaped field even when this process holds a different value", () => {
    // The mismatched-secret case: the value in the message is not the one `engineSecret()` reads,
    // which is exactly why the call failed.
    vi.stubEnv("ENGINE_SECRET", "the-new-one");

    const message = safeErrorMessage('Server Error: { secret: "the-old-one", token: abc123 }');

    expect(message).not.toContain("the-old-one");
    expect(message).not.toContain("abc123");
  });

  it("leaves a variable name alone — that is the part an operator needs", () => {
    clearEnv();
    expect(safeErrorMessage(new Error("connections-engine: ENGINE_SECRET is not set"))).toBe(
      "connections-engine: ENGINE_SECRET is not set",
    );
  });

  it("flattens a multi-line error and caps it, so a log line stays a line", () => {
    clearEnv();
    const message = safeErrorMessage(new Error(`first\n\n   second ${"x".repeat(400)}`));

    expect(message).not.toContain("\n");
    expect(message.startsWith("first second")).toBe(true);
    expect(message.length).toBe(300);
  });

  it("describes a thrown non-error without inventing a cause", () => {
    clearEnv();
    expect(safeErrorMessage(undefined)).toBe("");
    expect(safeErrorMessage("nope")).toBe("nope");
  });
});

describe("orgPlanFromClerk without a Clerk key", () => {
  /**
   * The sibling misconfiguration: the eve services are separate Vercel services with their own
   * environment, so `CLERK_SECRET_KEY` can be missing there too. Falling back to `free_org` would
   * tell a paying organisation that its plan does not include the Builder — a wrong sentence for
   * something only an operator can fix — so a missing key is terminal and names itself.
   */
  it("refuses with the variable name rather than answering free_org", async () => {
    clearEnginePlanCache();
    vi.stubEnv("CLERK_SECRET_KEY", undefined);

    await expect(orgPlanFromClerk("org_1")).rejects.toMatchObject({
      name: "EngineUnavailableError",
      code: "service_unavailable",
      retryable: false,
      message: "billing-engine: CLERK_SECRET_KEY is not set",
    });
  });
});
