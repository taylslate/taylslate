import { describe, expect, it, vi } from "vitest";
import { buildDueSpots } from "@/lib/airchecks/select";
import type { DueSpot } from "@/lib/airchecks/select";
import type { AircheckPersist } from "@/lib/airchecks/persist";
import { GOOGLE_DERIVED_AIRCHECK_PROVIDERS } from "@/lib/learning/google-data";
import {
  YOUTUBE_CAPTION_PROVIDER,
  clearCaptionText,
  runYoutubeCaptionAirchecks,
  type FeedConnection,
  type YoutubeCaptionDeps,
} from "./feed";

type MetricsRow = Parameters<YoutubeCaptionDeps["saveMetrics"]>[0];

const NOW = new Date("2026-11-11T20:00:00.000Z");
const VIDEO = "abcdefghijk";

function spot(overrides: Partial<DueSpot> = {}): DueSpot {
  return {
    ioLineItemId: "line-1",
    dealId: "deal-1",
    showId: "show-1",
    format: "youtube",
    postDate: "2026-11-10",
    window: { start: "2026-11-10", end: "2026-11-16" },
    episodeUrl: `https://www.youtube.com/watch?v=${VIDEO}`,
    placement: "mid-roll",
    rssUrl: null,
    youtubeChannelId: "UCchannel",
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

function connection(overrides: Partial<FeedConnection> = {}): FeedConnection {
  return {
    id: "conn-1",
    showProfileId: "profile-1",
    channelId: "UCchannel",
    analytics: true,
    accessToken: "access-token",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    lastVerifiedAt: NOW.toISOString(),
    ...overrides,
  };
}

function deps(overrides: Partial<YoutubeCaptionDeps> = {}): YoutubeCaptionDeps {
  return {
    now: NOW,
    configured: () => true,
    tablesReady: async () => true,
    housekeeping: async () => undefined,
    reverify: async () => undefined,
    loadSpots: async () => [spot()],
    loadDealProfiles: async () => [{ dealId: "deal-1", showProfileId: "profile-1" }],
    loadConnections: async () => [connection()],
    countActive: async () => 1,
    findEpisode: async () => ({
      episodeIdentifier: VIDEO,
      audioUrl: null,
      durationSeconds: 100,
      source: "youtube",
      note: null,
    }),
    commitQuota: async (_day, units) => ({ accepted: units, missing: false }),
    setReserve: async () => undefined,
    refresh: async () => ({ ok: false, invalidGrant: false }),
    markReauth: async () => undefined,
    listCaptions: async () => ({
      ok: true,
      tracks: [{ id: "track-1", language: "en", trackKind: "standard" }],
    }),
    downloadCaption: async () => ({
      ok: true,
      vtt: `WEBVTT

00:00:40.000 --> 00:00:50.000
This read is from Sauna Box. Use code HUBERMAN at saunabox.com.
`,
    }),
    videoDetails: async () => ({
      ok: true,
      details: {
        durationSeconds: 100,
        publishedAt: "2026-11-05T00:00:00.000Z",
        defaultLanguage: "en",
      },
    }),
    fetchAnalytics: async () => ({
      ok: true,
      analytics: { views: 1000, estimatedMinutesWatched: 400, averageViewDurationSeconds: 90 },
    }),
    fetchRetention: async () => ({
      ok: true,
      points: [0.4, 0.49, 0.5, 0.51, 0.52, 0.8].map((ratio) => ({
        ratio,
        audience_watch_ratio: 0.7,
        relative_retention_performance: 1.1,
      })),
    }),
    save: async () => ({ id: "aircheck-1" }),
    record: async () => null,
    saveMetrics: async () => undefined,
    loadMetrics: async () => null,
    clock: () => NOW.getTime(),
    timeBudgetMs: 60_000,
    log: () => undefined,
    ...overrides,
  };
}

describe("youtube caption feed", () => {
  it("uses the provider value learning excludes", () => {
    expect(YOUTUBE_CAPTION_PROVIDER).toBe("youtube-captions");
    expect(GOOGLE_DERIVED_AIRCHECK_PROVIDERS).toContain(YOUTUBE_CAPTION_PROVIDER);
  });

  it("leaves a spot with no connection untouched", async () => {
    const save = vi.fn();
    const report = await runYoutubeCaptionAirchecks(
      deps({ loadConnections: async () => [], save }),
      NOW
    );
    expect(save).not.toHaveBeenCalled();
    expect(report.considered).toBe(0);
    expect(report.captioned).toBe(0);
  });

  it("does not use a connection whose show profile is not the deal's", async () => {
    const save = vi.fn();
    await runYoutubeCaptionAirchecks(
      deps({
        loadConnections: async () => [connection({ showProfileId: "someone-else" })],
        save,
      }),
      NOW
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("writes the judgment fields with provider youtube-captions and the ready event", async () => {
    const save = vi.fn(async (_row: AircheckPersist) => ({ id: "aircheck-1" }));
    const record = vi.fn(async () => null);
    const saveMetrics = vi.fn(async (_row: MetricsRow) => undefined);
    const report = await runYoutubeCaptionAirchecks(deps({ save, record, saveMetrics }), NOW);
    expect(report.captioned).toBe(1);
    expect(report.ready).toBe(1);
    const row = save.mock.calls[0]?.[0];
    if (!row) throw new Error("caption row was not saved");
    expect(row).toMatchObject({
      io_line_item_id: "line-1",
      episode_identifier: VIDEO,
      audio_url: null,
      provider: "youtube-captions",
      status: "transcribed",
      error: null,
      audio_minutes: null,
      estimated_cost_usd: null,
      window_start: "2026-11-10",
      window_end: "2026-11-16",
      ready_for_review: true,
    });
    expect(row.transcript_text).toContain("Sauna Box");
    expect(row.transcript_segments?.length).toBeGreaterThan(0);
    expect(row.match_result).toBe("matched");
    expect(row.ad_start_seconds).not.toBeNull();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "aircheck.ready_for_review",
        entityType: "aircheck",
        entityId: "aircheck-1",
      })
    );
    const metrics = saveMetrics.mock.calls[0]?.[0];
    if (!metrics) throw new Error("analytics were not saved");
    expect(metrics.retention?.map((point) => point.ratio)).toEqual([0.4, 0.49, 0.5, 0.51]);
    expect(JSON.stringify(metrics)).not.toMatch(/score/i);
    expect(metrics).toMatchObject({
      views: 1000,
      estimated_minutes_watched: 400,
      average_view_duration_seconds: 90,
    });

    const due = buildDueSpots({
      today: "2026-11-11",
      nowMs: NOW.getTime(),
      deals: [
        {
          id: "deal-1",
          status: "show_signed",
          cancelled_at: null,
          show_id: "show-1",
          promo_code: "HUBERMAN",
          brand_profile_id: "brand-1",
          outreach_id: null,
        },
      ],
      ios: [{ id: "io-1", deal_id: "deal-1", advertiser_name: "Sauna Box", status: "signed" }],
      lines: [
        {
          id: "line-1",
          io_id: "io-1",
          format: "youtube",
          post_date: "2026-11-10",
          episode_url: null,
          placement: "mid-roll",
        },
      ],
      shows: [{ id: "show-1", rss_url: null, youtube_channel_id: "UCchannel" }],
      brands: [],
      pitches: [],
      airchecks: [
        {
          io_line_item_id: row.io_line_item_id,
          status: row.status,
          transcript_text: row.transcript_text ?? null,
          ready_for_review: row.ready_for_review ?? false,
          match_result: row.match_result ?? null,
        },
      ],
      libraryChannels: [],
    });
    expect(due).toEqual([]);
  });

  it("stops the day when quota accepts less than the ask", async () => {
    const save = vi.fn();
    const report = await runYoutubeCaptionAirchecks(
      deps({
        save,
        loadSpots: async () => [spot(), spot({ ioLineItemId: "line-2" })],
        commitQuota: async () => ({ accepted: 1, missing: false }),
      }),
      NOW
    );
    expect(report.stopped).toBe("quota");
    expect(save).not.toHaveBeenCalled();
    expect(report.captioned).toBe(0);
  });

  it("stores a 403 with the attempt prefix and leaves the connection alone", async () => {
    const save = vi.fn(async (_row: AircheckPersist) => ({ id: "aircheck-1" }));
    const markReauth = vi.fn();
    await runYoutubeCaptionAirchecks(
      deps({
        save,
        markReauth,
        loadSpots: async () => [spot({ existingAttempt: 2 })],
        listCaptions: async () => ({ ok: false, reason: "owner" }),
      }),
      NOW
    );
    expect(markReauth).not.toHaveBeenCalled();
    const failed = save.mock.calls[0]?.[0];
    if (!failed) throw new Error("failure row was not saved");
    expect(failed.error).toBe("attempt=3; captions need owner access");
    expect(failed.provider).toBe("youtube-captions");
  });

  it("marks the connection reauth_required when the refresh token is rejected", async () => {
    const save = vi.fn();
    const markReauth = vi.fn();
    const report = await runYoutubeCaptionAirchecks(
      deps({
        save,
        markReauth,
        loadConnections: async () => [connection({ accessToken: null, accessTokenExpiresAt: null })],
        refresh: async () => ({ ok: false, invalidGrant: true }),
      }),
      NOW
    );
    expect(markReauth).toHaveBeenCalledWith("conn-1");
    expect(save).not.toHaveBeenCalled();
    expect(report.failed).toBe(0);
  });

  it("clears caption text after 30 days and keeps the judgment", async () => {
    const row = {
      transcript_text: "secret read",
      transcript_segments: [{ start_seconds: 1, end_seconds: 2, text: "secret read" }],
      match_evidence: { excerpt: "secret read", brand: "found", reason: null },
      match_result: "matched",
      confidence: 0.85,
      ad_start_seconds: 1800,
      ad_end_seconds: 1860,
      match_reasons: ["Brand found at 30:00."],
      updated_at: "2026-09-01T00:00:00.000Z",
      provider: "youtube-captions",
    };
    await runYoutubeCaptionAirchecks(
      deps({
        loadSpots: async () => [],
        housekeeping: async (now) => {
          const before = now.getTime() - 30 * 24 * 60 * 60 * 1000;
          if (Date.parse(row.updated_at) < before && row.provider === "youtube-captions") {
            Object.assign(row, clearCaptionText(row));
          }
        },
      }),
      NOW
    );
    expect(row.transcript_text).toBeNull();
    expect(row.transcript_segments).toBeNull();
    expect(row.match_evidence.excerpt).toBeNull();
    expect(row.match_evidence.brand).toBe("found");
    expect(row.match_result).toBe("matched");
    expect(row.confidence).toBe(0.85);
    expect(row.ad_start_seconds).toBe(1800);
    expect(row.ad_end_seconds).toBe(1860);
    expect(row.match_reasons).toEqual(["Brand found at 30:00."]);
  });
});
