import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyticsEnabled, toYoutubeStatus } from "./store";

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
});
