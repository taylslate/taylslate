import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeepgramProvider } from "./deepgram";

const AUDIO = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  filename: "episode.mp3",
  mimeType: "audio/mpeg",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("deepgram nova-3 provider", () => {
  it("skips without calling the network when DEEPGRAM_API_KEY is unset", async () => {
    const fetchMock = vi.fn();
    const provider = createDeepgramProvider({ DEEPGRAM_API_KEY: "   " }, fetchMock);
    expect(provider.id).toBe("deepgram-nova-3");
    expect(provider.usdPerMinute).toBe(0.0056);
    expect(provider.isConfigured()).toBe(false);
    const result = await provider.transcribe(AUDIO);
    expect(result).toEqual({
      ok: false,
      reason: "missing_api_key",
      message: "DEEPGRAM_API_KEY is not set",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends Nova-3 options, redact_usage, and one encoded keyterm per hint", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          metadata: { duration: 12.5 },
          results: {
            channels: [{ alternatives: [{ transcript: "Hello from the channel." }] }],
            utterances: [
              { start: 1.2, end: 4.5, transcript: " Hello from the channel." },
              { start: 9, end: 3, transcript: "reversed" },
              { start: "nope", end: 1, transcript: "bad" },
              { start: 5, end: 8, transcript: "Second line." },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const hints = ["Sauna Box", "Sauna Box", "HUBERMAN", ` ${"x".repeat(80)} `];
    for (let i = 0; i < 20; i += 1) hints.push(`brand-${i}`);
    const provider = createDeepgramProvider({ DEEPGRAM_API_KEY: "dg-test-key" }, fetchMock);
    const result = await provider.transcribe({ ...AUDIO, hints });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe("deepgram-nova-3");
    expect(result.text).toBe("Hello from the channel.");
    expect(result.durationSeconds).toBe(12.5);
    expect(result.segments).toEqual([
      { start_seconds: 1.2, end_seconds: 4.5, text: "Hello from the channel." },
      { start_seconds: 5, end_seconds: 8, text: "Second line." },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://api.deepgram.com/v1/listen");
    expect(parsed.searchParams.get("model")).toBe("nova-3");
    expect(parsed.searchParams.get("utterances")).toBe("true");
    expect(parsed.searchParams.get("smart_format")).toBe("true");
    expect(parsed.searchParams.get("punctuate")).toBe("true");
    expect(parsed.searchParams.get("mip_opt_out")).toBe("true");
    expect(parsed.searchParams.get("redact_usage")).toBe("true");
    const terms = parsed.searchParams.getAll("keyterm");
    expect(terms).toHaveLength(20);
    expect(terms[0]).toBe("Sauna Box");
    expect(terms[1]).toBe("HUBERMAN");
    expect(terms[2]).toHaveLength(60);
    expect(terms.filter((term) => term === "Sauna Box")).toHaveLength(1);
    expect(url).not.toContain("Sauna Box");
    expect((init.headers as { Authorization: string }).Authorization).toBe("Token dg-test-key");
    expect((init.headers as { "Content-Type": string })["Content-Type"]).toBe("audio/mpeg");
    expect(init.body).toBe(AUDIO.bytes);
    expect(JSON.stringify(result)).not.toContain("dg-test-key");
  });

  it("joins utterances when the channel transcript is missing", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          metadata: { duration: 4 },
          results: {
            utterances: [
              { start: 0, end: 1, transcript: "Sauna Box" },
              { start: 1, end: 2, transcript: "HUBERMAN" },
            ],
          },
        }),
        { status: 200 }
      );
    });
    const provider = createDeepgramProvider({ DEEPGRAM_API_KEY: "dg-test-key" }, fetchMock);
    const result = await provider.transcribe(AUDIO);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Sauna Box HUBERMAN");
    expect(result.segments).toHaveLength(2);
  });

  it("returns http with redacted text for 4xx and 5xx", async () => {
    const denied = vi.fn(async () => new Response("nope sk-supersecretkey Token dg-test-key", { status: 403 }));
    const provider = createDeepgramProvider({ DEEPGRAM_API_KEY: "dg-test-key" }, denied);
    const four = await provider.transcribe(AUDIO);
    expect(four.ok).toBe(false);
    if (four.ok) return;
    expect(four.reason).toBe("http");
    expect(four.message).toContain("403");
    expect(four.message).toContain("sk-[redacted]");
    expect(four.message).not.toContain("sk-supersecretkey");
    expect(four.message).not.toContain("dg-test-key");

    const down = vi.fn(async () => new Response("upstream sk-othersecret", { status: 503 }));
    const five = await createDeepgramProvider({ DEEPGRAM_API_KEY: "dg-test-key" }, down).transcribe(AUDIO);
    expect(five.ok).toBe(false);
    if (five.ok) return;
    expect(five.reason).toBe("http");
    expect(five.message).toContain("503");
    expect(five.message).not.toContain("sk-othersecret");
  });

  it("returns invalid for bad JSON and empty for an empty transcript", async () => {
    const invalidFetch = vi.fn(async () => new Response("not-json", { status: 200 }));
    const invalid = await createDeepgramProvider({ DEEPGRAM_API_KEY: "dg-test-key" }, invalidFetch).transcribe(
      AUDIO
    );
    expect(invalid).toEqual({
      ok: false,
      reason: "invalid",
      message: "Deepgram returned invalid JSON",
    });

    const emptyFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ metadata: { duration: 1 }, results: { utterances: [] } }), {
        status: 200,
      });
    });
    const empty = await createDeepgramProvider({ DEEPGRAM_API_KEY: "dg-test-key" }, emptyFetch).transcribe(AUDIO);
    expect(empty).toEqual({
      ok: false,
      reason: "empty",
      message: "Deepgram returned an empty transcript",
    });
  });

  it("reports a timeout as timed out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("The operation was aborted"));
        });
      });
    });
    const provider = createDeepgramProvider(
      { DEEPGRAM_API_KEY: "dg-test-key" },
      fetchMock as typeof fetch
    );
    const pending = provider.transcribe(AUDIO);
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("http");
    expect(result.message).toMatch(/timed out/);
    expect(result.message).not.toContain("dg-test-key");
  });
});
