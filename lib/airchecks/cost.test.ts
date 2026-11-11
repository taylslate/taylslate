import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AIRCHECK_RUN_COST_CAP_USD,
  DEEPGRAM_USD_PER_MINUTE,
  WHISPER_USD_PER_MINUTE,
  aircheckCostLog,
  estimateTranscriptCostUsd,
  estimateWhisperCostUsd,
  readRunCostCapUsd,
} from "./cost";

describe("whisper cost", () => {
  it("prices whisper-1 at $0.006 per minute", () => {
    expect(WHISPER_USD_PER_MINUTE).toBe(0.006);
    expect(estimateWhisperCostUsd(45 * 60)).toBe(0.27);
    expect(estimateWhisperCostUsd(60 * 60)).toBe(0.36);
  });

  it("prices Deepgram Nova-3 with keyterms at $0.0056 per minute", () => {
    expect(DEEPGRAM_USD_PER_MINUTE).toBe(0.0056);
    expect(estimateTranscriptCostUsd(45 * 60, 0.0056)).toBe(0.252);
    expect(estimateTranscriptCostUsd(30 * 60, DEEPGRAM_USD_PER_MINUTE)).toBe(0.168);
    expect(estimateTranscriptCostUsd(60 * 60, DEEPGRAM_USD_PER_MINUTE)).toBe(0.336);
  });

  it("reads the per-run cap from the env and defaults to $1", () => {
    expect(readRunCostCapUsd("")).toBe(DEFAULT_AIRCHECK_RUN_COST_CAP_USD);
    expect(readRunCostCapUsd("2.5")).toBe(2.5);
    expect(readRunCostCapUsd("0")).toBe(0);
    expect(readRunCostCapUsd("nope")).toBe(1);
  });

  it("logs minutes and estimated cost without a key", () => {
    const line = aircheckCostLog({
      ioLineItemId: "line-1",
      minutes: 45,
      estimatedCostUsd: 0.27,
      provider: "openai-whisper",
    });
    expect(line).toBe(
      "[aircheck] line=line-1 minutes=45.00 estimated_cost_usd=0.2700 provider=openai-whisper"
    );
    expect(line).not.toMatch(/sk-|api[_-]?key/i);
  });
});

afterEach(() => {
  delete process.env.AIRCHECK_RUN_COST_CAP_USD;
});
