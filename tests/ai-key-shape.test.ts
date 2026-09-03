import { describe, expect, it } from "vitest";

import { keyShapeProblem } from "@/lib/ai/key-shape";

/**
 * The point of this file is what it does NOT reject: a shape check that refuses a valid key is
 * worse than the 401 it was meant to explain, so every rule here is one a provider's own docs
 * state outright.
 */
describe("keyShapeProblem — Anthropic", () => {
  it("accepts a standard API key", () => {
    expect(keyShapeProblem("anthropic", "sk-ant-api03-aaaabbbbcccc")).toBeNull();
    expect(keyShapeProblem("anthropic", "sk-ant-wxyz")).toBeNull();
    expect(keyShapeProblem("anthropic", "  sk-ant-api03-padded  ")).toBeNull();
  });

  it("names an Admin key for what it is", () => {
    const problem = keyShapeProblem("anthropic", "sk-ant-admin01-aaaa");
    expect(problem).toContain("Admin API key");
    expect(problem).toContain("Settings → API keys");
  });

  it("names a Claude Code OAuth token for what it is", () => {
    expect(keyShapeProblem("anthropic", "sk-ant-oat01-aaaa")).toContain("OAuth token");
  });

  it("spots another provider's key", () => {
    expect(keyShapeProblem("anthropic", "sk-proj-aaaa")).toContain("another provider");
    expect(keyShapeProblem("anthropic", "gsk_aaaa")).toContain("starts sk-ant-");
  });
});

describe("keyShapeProblem — the reverse mistake", () => {
  it("spots an Anthropic key pasted into another provider", () => {
    expect(keyShapeProblem("openai", "sk-ant-api03-aaaa")).toContain("Anthropic API key");
    expect(keyShapeProblem("groq", "sk-ant-api03-aaaa")).toContain("Groq");
  });

  it("spots an sk- key pasted into Google", () => {
    expect(keyShapeProblem("google", "sk-proj-aaaa")).toContain("AIza");
    expect(keyShapeProblem("google", "AIzaSyAaaaa")).toBeNull();
  });

  it("leaves every other provider's format to the provider", () => {
    expect(keyShapeProblem("openai", "sk-proj-aaaa")).toBeNull();
    expect(keyShapeProblem("groq", "gsk_aaaa")).toBeNull();
    expect(keyShapeProblem("mistral", "whatever-they-issue")).toBeNull();
    expect(keyShapeProblem("openrouter", "sk-or-v1-aaaa")).toBeNull();
    expect(keyShapeProblem("anthropic", "")).toBeNull();
  });
});
