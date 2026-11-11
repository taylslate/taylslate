import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AircheckPersist } from "./persist";
import { runAutomatedAirchecks, type AircheckRunDeps } from "./run";
import { splitAudioForWhisper } from "./audio";
import type { DueSpot } from "./select";
import type { TranscriptProvider } from "./provider";

function spot(overrides: Partial<DueSpot> = {}): DueSpot {
  return {
    ioLineItemId: "line-1",
    dealId: "deal-1",
    showId: "show-1",
    format: "podcast",
    postDate: "2026-11-03",
    window: { start: "2026-11-03", end: "2026-11-09" },
    episodeUrl: null,
    placement: "mid-roll",
    rssUrl: "https://feeds.example.com/show.xml",
    youtubeChannelId: null,
    buy: {
      brandNames: ["Sauna Box"],
      promoCode: "HUBERMAN",
      url: "https://saunabox.com",
      placement: "mid-roll",
      talkingPoints: null,
    },
    existingAttempt: 0,
    priorFailure: false,
    existingTranscript: null,
    ...overrides,
  };
}

function provider(durationSeconds: number): TranscriptProvider {
  return {
    id: "openai-whisper",
    usdPerMinute: 0.006,
    isConfigured: () => true,
    transcribe: vi.fn(async () => ({
      ok: true as const,
      provider: "openai-whisper",
      text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
      segments: [
        {
          start_seconds: 600,
          end_seconds: 650,
          text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
        },
      ],
      durationSeconds,
    })),
  };
}

function deps(partial: Partial<AircheckRunDeps>): AircheckRunDeps {
  return {
    now: new Date("2026-11-03T12:00:00Z"),
    provider: provider(600),
    capUsd: 1,
    columnsReady: async () => true,
    loadSpots: async () => [spot()],
    findEpisode: async () => ({
      episodeIdentifier: "ep-1",
      audioUrl: "https://cdn.example.com/ep.mp3",
      durationSeconds: 600,
      source: "rss",
      note: null,
    }),
    download: async () => ({
      ok: true,
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: "audio/mpeg",
        filename: "ep.mp3",
      },
    }),
    save: async (row) => ({ id: `air-${row.io_line_item_id}` }),
    record: async () => null,
    log: () => undefined,
    splitAudio: splitAudioForWhisper,
    clock: () => Date.now(),
    timeBudgetMs: 200_000,
    ...partial,
  };
}

describe("runAutomatedAirchecks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips the run when the provider is not configured", async () => {
    const loadSpots = vi.fn();
    const lines: string[] = [];
    const report = await runAutomatedAirchecks(
      deps({
        provider: { ...provider(600), isConfigured: () => false },
        loadSpots,
        log: (line) => lines.push(line),
      })
    );
    expect(report.skipped).toBe("missing_transcription_api_key");
    expect(lines).toContain(
      "[aircheck] skipped no transcription provider configured (DEEPGRAM_API_KEY and OPENAI_API_KEY unset, or whisper-1 past shutdown)"
    );
    expect(loadSpots).not.toHaveBeenCalled();
    expect(report.transcribed).toBe(0);
  });

  it("skips with a logged reason and fetches nothing when no transcription key is set", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const loadSpots = vi.fn();
    const lines: string[] = [];
    const report = await runAutomatedAirchecks({
      log: (line) => lines.push(line),
      loadSpots,
    });
    expect(report.skipped).toBe("missing_transcription_api_key");
    expect(lines).toEqual([
      "[aircheck] skipped no transcription provider configured (DEEPGRAM_API_KEY and OPENAI_API_KEY unset, or whisper-1 past shutdown)",
    ]);
    expect(loadSpots).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(report.transcribed).toBe(0);
  });

  it("uses whisper-1 and logs the fallback when only OPENAI_API_KEY is set", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-fallback");
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
          duration: 600,
          segments: [
            {
              start: 600,
              end: 650,
              text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const lines: string[] = [];
    const { provider: _provider, ...rest } = deps({ log: (line) => lines.push(line) });
    const report = await runAutomatedAirchecks(rest);
    expect(lines[0]).toBe("[aircheck] provider=whisper-1 fallback (DEEPGRAM_API_KEY unset)");
    expect(report.skipped).toBeNull();
    expect(report.transcribed).toBe(1);
    expect(report.spentUsd).toBe(0.06);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init.headers as { Authorization: string }).Authorization).toBe("Bearer sk-test-fallback");
    expect(lines.join(" ")).not.toContain("sk-test-fallback");
  });

  it("stops before a download that would pass the cost cap", async () => {
    const download = vi.fn();
    const report = await runAutomatedAirchecks(
      deps({
        capUsd: 0.05,
        download,
        findEpisode: async () => ({
          episodeIdentifier: "ep-1",
          audioUrl: "https://cdn.example.com/ep.mp3",
          durationSeconds: 45 * 60,
          source: "rss",
          note: null,
        }),
      })
    );
    expect(report.stopped).toBe("cost_cap");
    expect(download).not.toHaveBeenCalled();
    expect(report.spentUsd).toBe(0);
  });

  it("transcribes one booked episode, stores the match, and leaves payment fields alone", async () => {
    const saved: AircheckPersist[] = [];
    const events: string[] = [];
    const lines: string[] = [];
    const report = await runAutomatedAirchecks(
      deps({
        save: async (row) => {
          saved.push(row);
          return { id: "air-1" };
        },
        record: async (input) => {
          events.push(input.eventType);
          return null;
        },
        log: (line) => lines.push(line),
      })
    );
    expect(report.transcribed).toBe(1);
    expect(report.readyForReview).toBe(1);
    expect(report.spentUsd).toBe(0.06);
    expect(saved[0]).toMatchObject({
      io_line_item_id: "line-1",
      status: "transcribed",
      provider: "openai-whisper",
      ready_for_review: true,
      audio_minutes: 10,
      estimated_cost_usd: 0.06,
      match_result: "matched",
    });
    expect(saved[0].transcript_segments?.[0]?.start_seconds).toBe(600);
    expect(saved[0].match_reasons?.some((reason) => reason.includes("Ready for review"))).toBe(true);
    expect(saved[0]).not.toHaveProperty("verified");
    expect(JSON.stringify(saved[0])).not.toMatch(/payment|stripe|charge/i);
    expect(events).toEqual(["aircheck.ready_for_review", "aircheck.transcribed"]);
    expect(lines[0]).toContain("minutes=10.00");
    expect(lines[0]).toContain("estimated_cost_usd=0.0600");
  });

  it("matches a stored transcript without downloading audio again", async () => {
    const download = vi.fn();
    const saved: AircheckPersist[] = [];
    const report = await runAutomatedAirchecks(
      deps({
        download,
        loadSpots: async () => [
          spot({
            existingTranscript:
              "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
          }),
        ],
        save: async (row) => {
          saved.push(row);
          return { id: "air-existing" };
        },
      })
    );
    expect(download).not.toHaveBeenCalled();
    expect(report.transcribed).toBe(0);
    expect(report.readyForReview).toBe(1);
    expect(saved[0].ready_for_review).toBe(true);
    expect(saved[0].match_result).toBe("matched");
    expect(saved[0]).not.toHaveProperty("audio_url");
    expect(saved[0]).not.toHaveProperty("provider");
  });

  it("does not call Whisper when a YouTube spot has no audio file", async () => {
    const transcribe = vi.fn();
    const saved: AircheckPersist[] = [];
    const report = await runAutomatedAirchecks(
      deps({
        loadSpots: async () => [spot({ format: "youtube", youtubeChannelId: "UCbooked" })],
        provider: { ...provider(600), transcribe },
        findEpisode: async () => ({
          episodeIdentifier: "spotvideo11",
          audioUrl: null,
          durationSeconds: 2700,
          source: "youtube",
          note: "YouTube video spotvideo11 is the episode in this air window. The Data API does not return an audio file, so it was not transcribed.",
        }),
        save: async (row) => {
          saved.push(row);
          return { id: "air-yt" };
        },
      })
    );
    expect(transcribe).not.toHaveBeenCalled();
    expect(report.youtubeWithoutAudio).toBe(1);
    expect(report.readyForReview).toBe(0);
    expect(saved[0].status).toBe("failed");
    expect(saved[0].ready_for_review).toBe(false);
    expect(saved[0].error).toContain("does not return an audio file");
  });

  it("stops between Whisper chunks when the cap is already spent", async () => {
    const transcribe = vi.fn(async () => ({
      ok: true as const,
      provider: "openai-whisper",
      text: "This episode is brought to you by Sauna Box. Use code HUBERMAN.",
      segments: [
        {
          start_seconds: 0,
          end_seconds: 30,
          text: "This episode is brought to you by Sauna Box. Use code HUBERMAN.",
        },
      ],
      durationSeconds: 600,
    }));
    const report = await runAutomatedAirchecks(
      deps({
        capUsd: 0.06,
        provider: { ...provider(600), transcribe },
        splitAudio: () => [new Uint8Array([1]), new Uint8Array([2])],
      })
    );
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(report.stopped).toBe("cost_cap");
    expect(report.spentUsd).toBe(0.06);
  });

  it("estimates cost from the larger of the feed duration and the file size", async () => {
    const transcribe = vi.fn();
    const report = await runAutomatedAirchecks(
      deps({
        capUsd: 0.01,
        provider: { ...provider(30), transcribe },
        findEpisode: async () => ({
          episodeIdentifier: "ep-1",
          audioUrl: "https://cdn.example.com/ep.mp3",
          durationSeconds: 30,
          source: "rss",
          note: null,
        }),
        download: async () => ({
          ok: true,
          audio: {
            bytes: new Uint8Array(3_200_000),
            mimeType: "audio/mpeg",
            filename: "ep.mp3",
          },
        }),
      })
    );
    expect(transcribe).not.toHaveBeenCalled();
    expect(report.stopped).toBe("cost_cap");
    expect(report.spentUsd).toBe(0);
  });

  it("counts Whisper spend when the save fails after transcription", async () => {
    const report = await runAutomatedAirchecks(
      deps({
        save: async () => {
          throw new Error("save failed sk-supersecretkey");
        },
        log: () => undefined,
      })
    );
    expect(report.failed).toBe(1);
    expect(report.spentUsd).toBe(0.06);
  });

  it("checks the time budget before each Whisper chunk", async () => {
    let now = 0;
    const transcribe = vi.fn(async () => {
      now = 200_000;
      return {
        ok: true as const,
        provider: "openai-whisper",
        text: "This episode is brought to you by Sauna Box. Use code HUBERMAN.",
        segments: [{ start_seconds: 0, end_seconds: 10, text: "Sauna Box HUBERMAN" }],
        durationSeconds: 10,
      };
    });
    const report = await runAutomatedAirchecks(
      deps({
        clock: () => now,
        timeBudgetMs: 200_000,
        provider: { ...provider(10), transcribe },
        splitAudio: () => [new Uint8Array([1]), new Uint8Array([2])],
      })
    );
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(report.stopped).toBe("time");
  });

  it("counts the size estimate when Whisper times out or reports no duration", async () => {
    const bytes = new Uint8Array(960_000);
    const timedOut = await runAutomatedAirchecks(
      deps({
        provider: {
          ...provider(0),
          transcribe: vi.fn(async () => ({
            ok: false as const,
            reason: "http" as const,
            message: "Whisper timed out",
          })),
        },
        download: async () => ({
          ok: true,
          audio: { bytes, mimeType: "audio/mpeg", filename: "ep.mp3" },
        }),
      })
    );
    expect(timedOut.spentUsd).toBe(0.006);
    expect(timedOut.failed).toBe(1);

    const zeroDuration = await runAutomatedAirchecks(
      deps({
        provider: {
          ...provider(0),
          transcribe: vi.fn(async () => ({
            ok: true as const,
            provider: "openai-whisper",
            text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
            segments: [],
            durationSeconds: 0,
          })),
        },
        download: async () => ({
          ok: true,
          audio: { bytes, mimeType: "audio/mpeg", filename: "ep.mp3" },
        }),
      })
    );
    expect(zeroDuration.spentUsd).toBe(0.006);
  });

  it("stops starting spots once the time budget is used", async () => {
    let now = 1_000;
    const findEpisode = vi.fn(async () => ({
      episodeIdentifier: "ep-1",
      audioUrl: "https://cdn.example.com/ep.mp3",
      durationSeconds: 600,
      source: "rss" as const,
      note: null,
    }));
    const report = await runAutomatedAirchecks(
      deps({
        clock: () => now,
        loadSpots: async () => [spot({ ioLineItemId: "line-1" }), spot({ ioLineItemId: "line-2" })],
        findEpisode,
        save: async () => {
          now = 1_000 + 200_000;
          return { id: "air-1" };
        },
      })
    );
    expect(findEpisode).toHaveBeenCalledTimes(1);
    expect(report.stopped).toBe("time");
    expect(report.considered).toBe(1);
  });

  it("redacts secrets from a stored failure", async () => {
    const saved: AircheckPersist[] = [];
    const lines: string[] = [];
    await runAutomatedAirchecks(
      deps({
        findEpisode: async () => {
          throw new Error("download failed sk-supersecretkey bearer sk-supersecretkey");
        },
        save: async (row) => {
          saved.push(row);
          return { id: "air-fail" };
        },
        log: (line) => lines.push(line),
      })
    );
    expect(saved[0].error).not.toContain("sk-supersecretkey");
    expect(saved[0].error).toContain("sk-[redacted]");
    expect(lines.join(" ")).not.toContain("sk-supersecretkey");
  });

  it("leaves the next spot and the report intact when one provider call throws", async () => {
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom sk-supersecretkey"))
      .mockResolvedValueOnce({
        ok: true as const,
        provider: "openai-whisper",
        text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
        segments: [
          {
            start_seconds: 600,
            end_seconds: 650,
            text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
          },
        ],
        durationSeconds: 600,
      });
    const saved: AircheckPersist[] = [];
    const report = await runAutomatedAirchecks(
      deps({
        provider: { ...provider(600), transcribe },
        loadSpots: async () => [spot({ ioLineItemId: "line-1" }), spot({ ioLineItemId: "line-2" })],
        save: async (row) => {
          saved.push(row);
          return { id: `air-${row.io_line_item_id}` };
        },
      })
    );
    expect(report.failed).toBe(1);
    expect(report.transcribed).toBe(1);
    expect(report.considered).toBe(2);
    expect(report.readyForReview).toBe(1);
    expect(saved.map((row) => row.io_line_item_id)).toEqual(["line-1", "line-2"]);
    expect(saved[0].status).toBe("failed");
    expect(saved[1].status).toBe("transcribed");
    expect(JSON.stringify(saved)).not.toContain("sk-supersecretkey");
  });

  it("fits a 0.0056 provider inside a cap that whisper's 0.006 misses", async () => {
    const findEpisode = async () => ({
      episodeIdentifier: "ep-1",
      audioUrl: "https://cdn.example.com/ep.mp3",
      durationSeconds: 45 * 60,
      source: "rss" as const,
      note: null,
    });
    const download = vi.fn(async () => ({
      ok: true as const,
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: "audio/mpeg",
        filename: "ep.mp3",
      },
    }));
    const transcribe = vi.fn(async () => ({
      ok: true as const,
      provider: "deepgram-nova-3",
      text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
      segments: [
        {
          start_seconds: 1,
          end_seconds: 30,
          text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
        },
      ],
      durationSeconds: 45 * 60,
    }));
    const blocked = await runAutomatedAirchecks(
      deps({
        capUsd: 0.26,
        provider: { ...provider(45 * 60), usdPerMinute: 0.006, transcribe },
        download,
        findEpisode,
      })
    );
    expect(blocked.stopped).toBe("cost_cap");
    expect(blocked.spentUsd).toBe(0);
    expect(download).not.toHaveBeenCalled();

    const saved: AircheckPersist[] = [];
    const allowed = await runAutomatedAirchecks(
      deps({
        capUsd: 0.26,
        provider: {
          ...provider(45 * 60),
          id: "deepgram-nova-3",
          usdPerMinute: 0.0056,
          transcribe,
        },
        download,
        findEpisode,
        save: async (row) => {
          saved.push(row);
          return { id: "air-rate" };
        },
      })
    );
    expect(download).toHaveBeenCalledTimes(1);
    expect(allowed.stopped).toBeNull();
    expect(allowed.transcribed).toBe(1);
    expect(allowed.spentUsd).toBe(0.252);
    expect(saved[0].estimated_cost_usd).toBe(0.252);
    expect(saved[0].provider).toBe("deepgram-nova-3");
  });

  it("passes brand, promo code, and url host hints to the provider", async () => {
    let hints: string[] | undefined;
    const transcribe = vi.fn(async (audio: { hints?: string[] }) => {
      hints = audio.hints;
      return {
        ok: true as const,
        provider: "deepgram-nova-3",
        text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
        segments: [
          {
            start_seconds: 600,
            end_seconds: 650,
            text: "This episode is brought to you by Sauna Box. Use code HUBERMAN at saunabox.com.",
          },
        ],
        durationSeconds: 600,
      };
    });
    await runAutomatedAirchecks(
      deps({
        provider: { ...provider(600), id: "deepgram-nova-3", usdPerMinute: 0.0056, transcribe },
        loadSpots: async () => [
          spot({
            buy: {
              brandNames: ["Sauna Box", "SaunaBox"],
              promoCode: "HUBERMAN",
              url: "https://www.saunabox.com/offer",
              placement: "mid-roll",
              talkingPoints: null,
            },
          }),
        ],
      })
    );
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(hints).toEqual(["Sauna Box", "SaunaBox", "HUBERMAN", "www.saunabox.com"]);
  });

  it("sums segment offsets across two split pieces", async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        provider: "deepgram-nova-3",
        text: "This episode is brought to you by Sauna Box.",
        segments: [{ start_seconds: 1, end_seconds: 4, text: "This episode is brought to you by Sauna Box." }],
        durationSeconds: 10,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        provider: "deepgram-nova-3",
        text: "Use code HUBERMAN at saunabox.com.",
        segments: [{ start_seconds: 2, end_seconds: 6, text: "Use code HUBERMAN at saunabox.com." }],
        durationSeconds: 10,
      });
    const saved: AircheckPersist[] = [];
    const report = await runAutomatedAirchecks(
      deps({
        provider: { ...provider(10), id: "deepgram-nova-3", usdPerMinute: 0.0056, transcribe },
        splitAudio: () => [new Uint8Array([1]), new Uint8Array([2])],
        save: async (row) => {
          saved.push(row);
          return { id: "air-split" };
        },
      })
    );
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(report.transcribed).toBe(1);
    expect(saved[0].transcript_segments).toEqual([
      {
        start_seconds: 1,
        end_seconds: 4,
        text: "This episode is brought to you by Sauna Box.",
      },
      {
        start_seconds: 12,
        end_seconds: 16,
        text: "Use code HUBERMAN at saunabox.com.",
      },
    ]);
  });

  it("does not import the charge path", () => {
    const runSrc = readFileSync(join(process.cwd(), "lib/airchecks/run.ts"), "utf8");
    const persistSrc = readFileSync(join(process.cwd(), "lib/airchecks/persist.ts"), "utf8");
    const routeSrc = readFileSync(join(process.cwd(), "app/api/cron/airchecks/route.ts"), "utf8");
    for (const src of [runSrc, persistSrc, routeSrc]) {
      expect(src).not.toMatch(/lib\/(stripe|payouts|billing)/);
      expect(src).not.toMatch(/chargeForEpisode|mark-delivered|deliverAndChargeLine/);
    }
    expect(runSrc).not.toMatch(/runMakeGoodDetectionHook/);
  });
});
