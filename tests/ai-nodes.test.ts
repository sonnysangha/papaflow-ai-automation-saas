import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { modelFor, providerFor } from "@/lib/ai/providers";
import { classifyNode } from "@/nodes/ai/classify";
import { extractNode } from "@/nodes/ai/extract";
import { llmNode } from "@/nodes/ai/llm";
import { ConnectorError, type RunContext } from "@/nodes/define";

/**
 * The AI nodes are `generateText` plus a provider factory and nothing else, so both are mocked:
 * these tests pin the call the node makes (which model, which key, which options) rather than a
 * provider's wire format. `Output.object` / `Output.choice` are pass-throughs that tag what they
 * were given, which is exactly what the assertions need to see.
 */
const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock("ai", () => ({
  generateText: generateTextMock,
  Output: {
    object: ({ schema }: { schema: z.ZodType }) => ({ kind: "object" as const, schema }),
    choice: ({ options }: { options: readonly string[] }) => ({ kind: "choice" as const, options }),
  },
}));

/** Every factory becomes `(modelId) => { provider, modelId, apiKey }`, so a model is inspectable. */
function factory(provider: string) {
  return vi.fn(({ apiKey }: { apiKey: string }) => (modelId: string) => ({
    provider,
    modelId,
    apiKey,
  }));
}

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: factory("openai") }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: factory("anthropic") }));
vi.mock("@ai-sdk/google", () => ({ createGoogle: factory("google") }));
vi.mock("@ai-sdk/xai", () => ({ createXai: factory("xai") }));
vi.mock("@ai-sdk/mistral", () => ({ createMistral: factory("mistral") }));
vi.mock("@ai-sdk/groq", () => ({ createGroq: factory("groq") }));
vi.mock("@ai-sdk/deepseek", () => ({ createDeepSeek: factory("deepseek") }));
vi.mock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter: factory("openrouter") }));

type GenerateTextCall = {
  model: { provider: string; modelId: string; apiKey: string };
  prompt?: string;
  instructions?: string;
  maxOutputTokens?: number;
  temperature?: number;
  output?: { kind: "object"; schema: z.ZodType } | { kind: "choice"; options: readonly string[] };
};

function callArgs(): GenerateTextCall {
  return generateTextMock.mock.calls[0][0] as GenerateTextCall;
}

function ctx<I>(inputs: I, credential: Record<string, unknown>): RunContext<I> {
  return { inputs, credential, orgId: "org_1", executionId: "exec_1", nodeId: "n1" };
}

const OPENAI = { provider: "openai", kind: "apiKey", apiKey: "sk-openai-1234" };
const ANTHROPIC = { provider: "anthropic", kind: "apiKey", apiKey: "sk-ant-5678" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("providerFor", () => {
  it("builds a provider for every AI connector kind", () => {
    for (const provider of [
      "openai",
      "anthropic",
      "google",
      "xai",
      "mistral",
      "groq",
      "deepseek",
      "openrouter",
    ]) {
      expect(modelFor(provider, "key-1", "some-model")).toEqual({
        provider,
        modelId: "some-model",
        apiKey: "key-1",
      });
    }
  });

  it("refuses a provider it has no factory for", () => {
    expect(() => providerFor("elevenlabs", "key-1")).toThrow(/elevenlabs/);
  });
});

describe("ai.llm", () => {
  it("is an AI node that needs an AI connection and no plan feature", () => {
    expect(llmNode).toMatchObject({
      type: "ai.llm",
      category: "ai",
      icon: "Sparkles",
      credential: "ai",
      requiresFeature: null,
      version: "v1",
    });
  });

  it("passes temperature to a provider that accepts it", async () => {
    generateTextMock.mockResolvedValue({
      text: "hello",
      finishReason: "stop",
      usage: { inputTokens: 11, outputTokens: 4 },
    });

    const output = await llmNode.run(
      ctx(
        llmNode.inputs.parse({
          connectionId: "conn_1",
          model: "gpt-5",
          instructions: "Be terse.",
          prompt: "Summarise this.",
          temperature: 0.2,
        }),
        OPENAI,
      ),
    );

    expect(callArgs()).toMatchObject({
      model: { provider: "openai", modelId: "gpt-5", apiKey: "sk-openai-1234" },
      instructions: "Be terse.",
      prompt: "Summarise this.",
      maxOutputTokens: 1024,
      temperature: 0.2,
    });

    expect(llmNode.outputs.parse(output)).toEqual({
      text: "hello",
      finishReason: "stop",
      usage: { inputTokens: 11, outputTokens: 4 },
    });
  });

  it("omits temperature for anthropic, whose 5-series rejects it with a 400", async () => {
    generateTextMock.mockResolvedValue({ text: "hi", finishReason: "stop", usage: {} });

    await llmNode.run(
      ctx(
        llmNode.inputs.parse({
          connectionId: "conn_1",
          model: "claude-fable-5-1",
          prompt: "Summarise this.",
          temperature: 0.7,
        }),
        ANTHROPIC,
      ),
    );

    const args = callArgs();
    expect(args.model).toMatchObject({ provider: "anthropic", modelId: "claude-fable-5-1" });
    expect("temperature" in args).toBe(false);
    // Nor a forced tool choice, which the same models also refuse.
    expect("toolChoice" in args).toBe(false);
  });

  it("omits temperature when the user did not set one", async () => {
    generateTextMock.mockResolvedValue({ text: "hi", finishReason: "stop", usage: {} });

    await llmNode.run(
      ctx(llmNode.inputs.parse({ connectionId: "conn_1", model: "gpt-5", prompt: "Hi" }), OPENAI),
    );

    expect("temperature" in callArgs()).toBe(false);
  });

  it("refuses to run without an opened connection", async () => {
    await expect(
      llmNode.run({
        inputs: llmNode.inputs.parse({ connectionId: "conn_1", model: "gpt-5", prompt: "Hi" }),
        credential: undefined,
        orgId: "org_1",
        executionId: "exec_1",
        nodeId: "n1",
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});

describe("ai.extract", () => {
  it("is an AI node that needs an AI connection and no plan feature", () => {
    expect(extractNode).toMatchObject({
      type: "ai.extract",
      category: "ai",
      icon: "ScanText",
      credential: "ai",
      requiresFeature: null,
    });
  });

  it("builds a zod object from the configured fields and returns the model's output", async () => {
    generateTextMock.mockResolvedValue({
      output: { name: "Ada", total: 42, paid: true, tags: ["a", "b"] },
    });

    const output = await extractNode.run(
      ctx(
        extractNode.inputs.parse({
          connectionId: "conn_1",
          model: "gpt-5",
          prompt: "Invoice text",
          fields: [
            { name: "name", type: "string", description: "Customer name" },
            { name: "total", type: "number" },
            { name: "paid", type: "boolean" },
            { name: "tags", type: "string[]" },
          ],
        }),
        OPENAI,
      ),
    );

    const args = callArgs();
    expect(args.model).toMatchObject({ provider: "openai", modelId: "gpt-5" });
    expect(args.prompt).toBe("Invoice text");
    expect(args.output?.kind).toBe("object");

    const schema = (args.output as { kind: "object"; schema: z.ZodType }).schema;
    expect(schema.parse({ name: "Ada", total: 42, paid: true, tags: ["a"] })).toEqual({
      name: "Ada",
      total: 42,
      paid: true,
      tags: ["a"],
    });
    expect(schema.safeParse({ name: "Ada", total: "42", paid: true, tags: [] }).success).toBe(false);

    const json = z.toJSONSchema(schema) as {
      properties: Record<string, { type?: string; description?: string }>;
    };
    expect(Object.keys(json.properties)).toEqual(["name", "total", "paid", "tags"]);
    expect(json.properties.name.description).toBe("Customer name");
    expect(json.properties.tags.type).toBe("array");

    expect(output).toEqual({ name: "Ada", total: 42, paid: true, tags: ["a", "b"] });
  });
});

describe("ai.classify", () => {
  it("is an AI node that needs an AI connection and no plan feature", () => {
    expect(classifyNode).toMatchObject({
      type: "ai.classify",
      category: "ai",
      icon: "Tags",
      credential: "ai",
      requiresFeature: null,
    });
  });

  it("hands the labels to Output.choice and returns the chosen one", async () => {
    generateTextMock.mockResolvedValue({ output: "billing" });

    const output = await classifyNode.run(
      ctx(
        classifyNode.inputs.parse({
          connectionId: "conn_1",
          model: "claude-fable-5-1",
          text: "My card was charged twice",
          labels: ["billing", "bug", "other"],
          instructions: "Pick the closest support queue.",
        }),
        ANTHROPIC,
      ),
    );

    const args = callArgs();
    expect(args.model).toMatchObject({ provider: "anthropic", modelId: "claude-fable-5-1" });
    expect(args.prompt).toBe("My card was charged twice");
    expect(args.instructions).toBe("Pick the closest support queue.");
    expect(args.output).toEqual({ kind: "choice", options: ["billing", "bug", "other"] });
    expect("temperature" in args).toBe(false);

    expect(classifyNode.outputs.parse(output)).toEqual({ label: "billing" });
  });

  it("needs at least two labels to choose between", () => {
    expect(
      classifyNode.inputs.safeParse({
        connectionId: "conn_1",
        model: "gpt-5",
        text: "hi",
        labels: ["only"],
      }).success,
    ).toBe(false);
  });
});
