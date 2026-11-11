import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => {
  const eqStatus = vi.fn(async () => ({ error: null }));
  const eqId = vi.fn(() => ({ eq: eqStatus }));
  const update = vi.fn(() => ({ eq: eqId }));
  const badEpisodeId = "short-id";
  const gt = vi.fn(async () => ({
    data: [
      {
        io_line_item_id: "line-bad",
        episode_identifier: badEpisodeId,
        duration_seconds: 90,
        ad_start_seconds: 10,
        ad_end_seconds: 40,
      },
    ],
    error: null,
  }));
  const eqTranscribed = vi.fn(() => ({ gt }));
  const eqProvider = vi.fn(() => ({ eq: eqTranscribed }));
  const select = vi.fn(() => ({ eq: eqProvider }));
  const from = vi.fn(() => ({ update, select }));
  return { eqStatus, eqId, update, from, select, eqProvider, eqTranscribed, gt, badEpisodeId };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: chain.from },
}));

import { analyticsEnabled, loadAnalyticsCandidateRows, markConnectionReauth, toYoutubeStatus } from "./store";

describe("youtube connection status", () => {
  it("returns only the caller's public fields", () => {
    const status = toYoutubeStatus({
      channel_id: "UCchannel",
      channel_title: "The Show",
      status: "active",
      scopes: ["https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/yt-analytics.readonly"],
    });
    expect(status).toEqual({
      connected: true,
      channel_id: "UCchannel",
      channel_title: "The Show",
      status: "active",
      analytics_enabled: true,
    });
    expect(Object.keys(status).sort()).toEqual([
      "analytics_enabled",
      "channel_id",
      "channel_title",
      "connected",
      "status",
    ]);
    expect(JSON.stringify(status)).not.toMatch(/token/i);

    expect(
      toYoutubeStatus({
        channel_id: "UCchannel",
        channel_title: "The Show",
        status: "reauth_required",
        scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
      })
    ).toMatchObject({ connected: false, status: "reauth_required", analytics_enabled: false });
    expect(toYoutubeStatus(null).connected).toBe(false);
    expect(analyticsEnabled(["https://www.googleapis.com/auth/yt-analytics.readonly"])).toBe(true);
  });

  it("does not select token columns for the status read", () => {
    const src = readFileSync(join(process.cwd(), "lib/youtube-oauth/store.ts"), "utf8");
    const start = src.indexOf("export async function readYoutubeStatus");
    const end = src.indexOf("export async function listActiveConnections");
    const body = src.slice(start, end);
    expect(src).toContain('const STATUS_COLUMNS = "channel_id, channel_title, status, scopes"');
    expect(body).toContain("select(STATUS_COLUMNS)");
    expect(body).not.toMatch(/token/);
  });

  it("sets reauth_required, nulls both tokens, and only updates an active row", async () => {
    const at = "2026-11-11T20:00:00.000Z";
    await markConnectionReauth("conn-1", at);
    expect(chain.from).toHaveBeenCalledWith("youtube_oauth_connections");
    expect(chain.update).toHaveBeenCalledWith({
      status: "reauth_required",
      refresh_token_enc: null,
      access_token_enc: null,
      access_token_expires_at: null,
      reauth_required_at: at,
    });
    expect(chain.eqId).toHaveBeenCalledWith("id", "conn-1");
    expect(chain.eqStatus).toHaveBeenCalledWith("status", "active");
  });

  it("loads analytics candidates created in the last 16 days and drops a non-video id", async () => {
    const now = new Date("2026-11-11T15:04:05.678Z");
    const since = new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000).toISOString();
    expect(since).toBe("2026-10-26T15:04:05.678Z");
    expect(chain.badEpisodeId).not.toMatch(/^[A-Za-z0-9_-]{11}$/);

    chain.from.mockClear();
    chain.select.mockClear();
    chain.eqProvider.mockClear();
    chain.eqTranscribed.mockClear();
    chain.gt.mockClear();

    const rows = await loadAnalyticsCandidateRows(now);

    expect(chain.from).toHaveBeenCalledWith("airchecks");
    expect(chain.select).toHaveBeenCalledWith(
      "io_line_item_id, episode_identifier, duration_seconds, ad_start_seconds, ad_end_seconds"
    );
    expect(chain.eqProvider).toHaveBeenCalledWith("provider", "youtube-captions");
    expect(chain.eqTranscribed).toHaveBeenCalledWith("status", "transcribed");
    expect(chain.gt).toHaveBeenCalledWith("created_at", since);
    expect(chain.from).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([]);
  });
});
