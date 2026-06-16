import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import {
  callLLMWithFallback,
  getLLMModel,
  loadPrompt,
  FALLBACK_MODEL,
} from "./client";

function message(stopReason: string, text = "{}") {
  return {
    stop_reason: stopReason,
    content: [{ type: "text", text }],
  };
}

describe("getLLMModel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to claude-opus-4-8", () => {
    vi.stubEnv("LLM_MODEL", "");
    expect(getLLMModel()).toBe("claude-opus-4-8");
  });

  it("uses LLM_MODEL when set", () => {
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-6");
    expect(getLLMModel()).toBe("claude-sonnet-4-6");
  });
});

describe("callLLMWithFallback", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  const input = { system: "sys", userContent: "page text", maxTokens: 1024 };

  it("makes a single call when the response is not a refusal", async () => {
    mockCreate.mockResolvedValue(message("end_turn"));
    const result = await callLLMWithFallback(input);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      {
        model: FALLBACK_MODEL,
        max_tokens: 1024,
        system: "sys",
        messages: [{ role: "user", content: "page text" }],
      },
      {} // no per-request bounds passed → empty options
    );
    expect(result.stop_reason).toBe("end_turn");
  });

  it("passes per-request timeout and maxRetries through to both calls", async () => {
    vi.stubEnv("LLM_MODEL", "claude-fable-5");
    mockCreate
      .mockResolvedValueOnce(message("refusal"))
      .mockResolvedValueOnce(message("end_turn", "{}"));

    await callLLMWithFallback({ ...input, timeoutMs: 60000, maxRetries: 0 });

    expect(mockCreate.mock.calls[0][1]).toEqual({ timeout: 60000, maxRetries: 0 });
    expect(mockCreate.mock.calls[1][1]).toEqual({ timeout: 60000, maxRetries: 0 });
  });

  it("retries once with claude-opus-4-8 on refusal from a configured model", async () => {
    vi.stubEnv("LLM_MODEL", "claude-fable-5");
    mockCreate
      .mockResolvedValueOnce(message("refusal"))
      .mockResolvedValueOnce(message("end_turn", '{"ok":true}'));

    const result = await callLLMWithFallback(input);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-fable-5");
    expect(mockCreate.mock.calls[1][0].model).toBe(FALLBACK_MODEL);
    expect(result.stop_reason).toBe("end_turn");
  });

  it("does not retry when the configured model is already the fallback", async () => {
    mockCreate.mockResolvedValue(message("refusal"));
    const result = await callLLMWithFallback(input);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.stop_reason).toBe("refusal");
  });

  it("returns the fallback refusal when both models refuse", async () => {
    vi.stubEnv("LLM_MODEL", "claude-fable-5");
    mockCreate.mockResolvedValue(message("refusal"));
    const result = await callLLMWithFallback(input);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.stop_reason).toBe("refusal");
  });
});

describe("loadPrompt", () => {
  it("reads the derive-product prompt from lib/prompts", () => {
    const text = loadPrompt("derive-product.md");
    expect(text).toContain("aov_bucket");
    expect(text).toContain("JSON");
    // Cached second read returns identical content
    expect(loadPrompt("derive-product.md")).toBe(text);
  });
});
