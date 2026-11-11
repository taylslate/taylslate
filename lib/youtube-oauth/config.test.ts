import { describe, expect, it } from "vitest";
import { YOUTUBE_OAUTH_SCOPES, readYoutubeOauthConfig, youtubeOauthConfigured, youtubeSettingsUrl } from "./config";

const KEY = Buffer.alloc(32, 3).toString("base64");

describe("youtube oauth config", () => {
  it("is unconfigured until every value is present, and the redirect host is the site URL", () => {
    const previous = {
      id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      key: process.env.YOUTUBE_TOKEN_ENC_KEY,
      site: process.env.NEXT_PUBLIC_SITE_URL,
    };
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.YOUTUBE_TOKEN_ENC_KEY;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(youtubeOauthConfigured()).toBe(false);

    process.env.GOOGLE_OAUTH_CLIENT_ID = "client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_TOKEN_ENC_KEY = KEY;
    process.env.NEXT_PUBLIC_SITE_URL = "https://taylslate.com/";
    expect(youtubeOauthConfigured()).toBe(true);
    expect(readYoutubeOauthConfig()?.redirectUri).toBe("https://www.taylslate.com/api/youtube/callback");
    expect(readYoutubeOauthConfig()?.siteBase).toBe("https://www.taylslate.com");
    expect(youtubeSettingsUrl({ connected: true })).toBe("https://www.taylslate.com/settings/youtube?connected=1");
    expect(youtubeSettingsUrl({ error: "channel_taken" })).toBe(
      "https://www.taylslate.com/settings/youtube?error=channel_taken"
    );
    expect(YOUTUBE_OAUTH_SCOPES).toEqual([
      "https://www.googleapis.com/auth/youtube.force-ssl",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ]);

    process.env.YOUTUBE_TOKEN_ENC_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(youtubeOauthConfigured()).toBe(false);

    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name === "id" ? "GOOGLE_OAUTH_CLIENT_ID" : name === "secret" ? "GOOGLE_OAUTH_CLIENT_SECRET" : name === "key" ? "YOUTUBE_TOKEN_ENC_KEY" : "NEXT_PUBLIC_SITE_URL"];
    }
    if (previous.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previous.id;
    if (previous.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = previous.secret;
    if (previous.key === undefined) delete process.env.YOUTUBE_TOKEN_ENC_KEY;
    else process.env.YOUTUBE_TOKEN_ENC_KEY = previous.key;
    if (previous.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous.site;
  });
});
