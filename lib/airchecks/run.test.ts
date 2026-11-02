import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
  it("skips the run when OPENAI_API_KEY is unset", async () => {
    const loadSpots = vi.fn();
    const report = await runAutomatedAirchecks(
      deps({
        provider: { ...provider(600), isConfigured: () => false },
        loadSpots,
      })
    );
    expect(report.skipped).toBe("missing_openai_api_key");
    expect(loadSpots).not.toHaveBeenCalled();
    expect(report.transcribed).toBe(0);
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
