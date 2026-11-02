import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiWhisperProvider } from "./openai-whisper";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
});

describe("openai whisper provider", () => {
  it("skips without calling the network when OPENAI_API_KEY is unset", async () => {
    const fetchMock = vi.fn();
    const provider = createOpenAiWhisperProvider("", fetchMock);
    expect(provider.isConfigured()).toBe(false);
    const result = await provider.transcribe({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "episode.mp3",
      mimeType: "audio/mpeg",
    });
    expect(result).toEqual({
      ok: false,
      reason: "missing_api_key",
      message: "OPENAI_API_KEY is not set",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the file to whisper-1 and keeps timestamped segments", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          text: "This episode is brought to you by Sauna Box.",
          duration: 12.5,
          segments: [
            { start: 1.2, end: 4.8, text: " This episode is brought to you by Sauna Box." },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const provider = createOpenAiWhisperProvider("sk-test-key", fetchMock);
    const result = await provider.transcribe({
      bytes: new Uint8Array([1, 2, 3, 4]),
      filename: "episode.mp3",
      mimeType: "audio/mpeg",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe("openai-whisper");
    expect(result.durationSeconds).toBe(12.5);
    expect(result.segments).toEqual([
      {
        start_seconds: 1.2,
        end_seconds: 4.8,
        text: "This episode is brought to you by Sauna Box.",
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init.headers as { Authorization: string }).Authorization).toBe("Bearer sk-test-key");
    expect(init.body).toBeInstanceOf(FormData);
    expect(JSON.stringify(result)).not.toContain("sk-test-key");
  });
});
