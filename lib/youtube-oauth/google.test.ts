import { describe, expect, it } from "vitest";
import { YOUTUBE_OAUTH_SCOPES } from "./config";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  parseGrantedScopes,
  refreshAccessToken,
} from "./google";

const SECRET = "super-secret-client-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("google oauth", () => {
  it("builds an auth URL with the two scopes, S256, offline, and consent, and no secret", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "client-id",
        redirectUri: "https://taylslate.com/api/youtube/callback",
        state: "state-value",
        verifier: "verifier-value",
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...YOUTUBE_OAUTH_SCOPES]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(20);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.toString()).not.toContain(SECRET);
    expect(url.toString()).not.toContain("openid");
    expect(url.searchParams.get("scope")).not.toContain("youtube.readonly");
    expect(url.searchParams.get("scope")).not.toContain("youtube.upload");
  });

  it("parses a granted scope string", () => {
    const both = parseGrantedScopes(YOUTUBE_OAUTH_SCOPES.join(" "));
    expect(both.forceSsl).toBe(true);
    expect(both.analytics).toBe(true);
    const captionsOnly = parseGrantedScopes(YOUTUBE_OAUTH_SCOPES[0]);
    expect(captionsOnly.forceSsl).toBe(true);
    expect(captionsOnly.analytics).toBe(false);
    const analyticsOnly = parseGrantedScopes(YOUTUBE_OAUTH_SCOPES[1]);
    expect(analyticsOnly.forceSsl).toBe(false);
    expect(analyticsOnly.analytics).toBe(true);
    expect(parseGrantedScopes("").forceSsl).toBe(false);
    expect(parseGrantedScopes(undefined).scopes).toEqual([]);
  });

  it("puts the client secret in the token body, not the URL", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : "" });
      return jsonResponse({
        access_token: "access",
        refresh_token: "refresh-plain",
        expires_in: 3600,
        scope: YOUTUBE_OAUTH_SCOPES.join(" "),
      });
    }) as typeof fetch;

    const exchanged = await exchangeAuthorizationCode(
      {
        code: "code",
        clientId: "client-id",
        clientSecret: SECRET,
        redirectUri: "https://taylslate.com/api/youtube/callback",
        verifier: "verifier",
      },
      fetchImpl
    );
    expect(exchanged.accessToken).toBe("access");
    expect(exchanged.refreshToken).toBe("refresh-plain");
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]?.url).not.toContain(SECRET);
    expect(calls[0]?.body).toContain(SECRET);
    expect(calls[0]?.body).toContain("code_verifier=verifier");

    await refreshAccessToken(
      { refreshToken: "refresh-plain", clientId: "client-id", clientSecret: SECRET },
      fetchImpl
    );
    expect(calls[1]?.url).not.toContain(SECRET);
    expect(calls[1]?.url).not.toContain("refresh-plain");
    expect(calls[1]?.body).toContain("grant_type=refresh_token");
    expect(calls[1]?.body).toContain(SECRET);
  });
});
