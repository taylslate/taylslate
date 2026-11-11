import { describe, expect, it } from "vitest";
import { WHISPER_1_SHUTDOWN_UTC, selectTranscriptProvider } from "./provider-select";

const BEFORE = new Date("2027-02-25T23:59:59.999Z");
const SHUTDOWN = new Date(WHISPER_1_SHUTDOWN_UTC);
const AFTER = new Date("2027-02-26T00:00:01.000Z");

describe("selectTranscriptProvider", () => {
  it("chooses Deepgram when both keys are set", () => {
    const selected = selectTranscriptProvider(BEFORE, {
      DEEPGRAM_API_KEY: "dg-test",
      OPENAI_API_KEY: "sk-test",
    });
    expect(selected.reason).toBe("deepgram");
    expect(selected.provider.id).toBe("deepgram-nova-3");
    expect(selected.provider.usdPerMinute).toBe(0.0056);
    expect(selected.provider.isConfigured()).toBe(true);
  });

  it("falls back to whisper-1 before the shutdown when only OPENAI_API_KEY is set", () => {
    const selected = selectTranscriptProvider(BEFORE, { OPENAI_API_KEY: "sk-test" });
    expect(selected.reason).toBe("whisper_fallback");
    expect(selected.provider.id).toBe("openai-whisper");
    expect(selected.provider.isConfigured()).toBe(true);
    expect(WHISPER_1_SHUTDOWN_UTC).toBe("2027-02-26T00:00:00Z");
  });

  it("does not choose whisper-1 on or after the shutdown", () => {
    for (const now of [SHUTDOWN, AFTER]) {
      const selected = selectTranscriptProvider(now, { OPENAI_API_KEY: "sk-test" });
      expect(selected.reason).toBe("none");
      expect(selected.provider.id).toBe("none");
      expect(selected.provider.isConfigured()).toBe(false);
    }
  });

  it("returns none when no key is set", () => {
    const selected = selectTranscriptProvider(BEFORE, {});
    expect(selected.reason).toBe("none");
    expect(selected.provider.id).toBe("none");
    expect(selected.provider.isConfigured()).toBe(false);
  });

  it("treats a whitespace-only or non-string key as missing", () => {
    const blank = selectTranscriptProvider(BEFORE, {
      DEEPGRAM_API_KEY: " \n ",
      OPENAI_API_KEY: "   ",
    });
    expect(blank.reason).toBe("none");
    expect(blank.provider.isConfigured()).toBe(false);

    const malformed = selectTranscriptProvider(BEFORE, {
      DEEPGRAM_API_KEY: 123,
      OPENAI_API_KEY: { key: "sk-test" },
    });
    expect(malformed.reason).toBe("none");
    expect(malformed.provider.isConfigured()).toBe(false);
  });

  it("never throws", async () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error("malformed env");
        },
      }
    );
    expect(() => selectTranscriptProvider(new Date(Number.NaN), null)).not.toThrow();
    expect(() => selectTranscriptProvider(BEFORE, throwing)).not.toThrow();
    expect(selectTranscriptProvider(BEFORE, throwing).reason).toBe("none");
    const none = selectTranscriptProvider(BEFORE, {});
    await expect(none.provider.transcribe({
      bytes: new Uint8Array([1]),
      filename: "ep.mp3",
      mimeType: "audio/mpeg",
    })).resolves.toMatchObject({ ok: false, reason: "missing_api_key" });
  });
});
