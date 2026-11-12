import { afterEach, describe, expect, it, vi } from "vitest";
import { YOUTUBE_OAUTH_SCOPES } from "./config";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  parseGrantedScopes,
  refreshAccessToken,
  revokeGoogleToken,
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
        redirectUri: "https://www.taylslate.com/api/youtube/callback",
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
        redirectUri: "https://www.taylslate.com/api/youtube/callback",
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

describe("revokeGoogleToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fetchStatuses(statuses: number[], bodies?: Array<Record<string, unknown>>): {
    fetchImpl: typeof fetch;
    calls: number;
  } {
    const state = { calls: 0 };
    const fetchImpl = (async () => {
      const index = state.calls;
      state.calls += 1;
      const status = statuses[index] ?? statuses[statuses.length - 1] ?? 500;
      return jsonResponse(bodies?.[index] ?? { error: "backend" }, status);
    }) as typeof fetch;
    return {
      fetchImpl,
      get calls() {
        return state.calls;
      },
    };
  }

  it("returns true on 200 and on invalid_token without retrying", async () => {
    const ok = fetchStatuses([200]);
    const attempts = { count: 0 };
    await expect(revokeGoogleToken("refresh-token", { fetchImpl: ok.fetchImpl, attempts })).resolves.toBe(true);
    expect(ok.calls).toBe(1);
    expect(attempts.count).toBe(1);

    const invalid = fetchStatuses([400], [{ error: "invalid_token" }]);
    const invalidAttempts = { count: 0 };
    await expect(
      revokeGoogleToken("refresh-token", { fetchImpl: invalid.fetchImpl, attempts: invalidAttempts })
    ).resolves.toBe(true);
    expect(invalid.calls).toBe(1);
    expect(invalidAttempts.count).toBe(1);
  });

  it("does not retry a 400 that is not invalid_token", async () => {
    vi.useFakeTimers();
    const denied = fetchStatuses([400], [{ error: "invalid_request" }]);
    const attempts = { count: 0 };
    const pending = revokeGoogleToken("refresh-token", { fetchImpl: denied.fetchImpl, attempts });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(false);
    expect(denied.calls).toBe(1);
    expect(attempts.count).toBe(1);
  });

  it("retries a 5xx and a network error, then stops", async () => {
    vi.useFakeTimers();
    const recovered = fetchStatuses([503, 200]);
    const attempts = { count: 0 };
    const pending = revokeGoogleToken("refresh-token", { fetchImpl: recovered.fetchImpl, attempts });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBe(true);
    expect(recovered.calls).toBe(2);
    expect(attempts.count).toBe(2);

    let networkCalls = 0;
    const network = (async () => {
      networkCalls += 1;
      throw new Error("socket hang up token=refresh-token");
    }) as typeof fetch;
    const networkAttempts = { count: 0 };
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const failed = revokeGoogleToken("refresh-token", { fetchImpl: network, attempts: networkAttempts });
    await vi.advanceTimersByTimeAsync(1250);
    await expect(failed).resolves.toBe(false);
    expect(networkCalls).toBe(3);
    expect(networkAttempts.count).toBe(3);
    expect(logs.join("\n")).not.toContain("refresh-token");
    spy.mockRestore();
  });

  it("returns true for an empty token and does not call Google", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const attempts = { count: 9 };
    await expect(revokeGoogleToken("", { fetchImpl, attempts })).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(attempts.count).toBe(0);
  });
});
