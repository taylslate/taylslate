import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OauthTestAdmin } from "./test-store";
import { SECRET_DB } from "./test-store";

const bridge = vi.hoisted(() => ({ admin: null as OauthTestAdmin | null }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => bridge.admin!.from(table),
    rpc: (name: string, args: Record<string, unknown>) => bridge.admin!.rpc(name, args),
  },
}));

import { beginAuthorization } from "./authorize";
import { OAuthUnavailableError } from "./errors";
import { TEST_ORIGIN, TEST_REDIRECT, createOauthTestAdmin, installOauthEnv, pkcePair } from "./test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
  bridge.admin.tables.mcp_oauth_clients.push({
    id: "33333333-3333-4333-8333-333333333333",
    client_id: `tsc_${"ab".repeat(16)}`,
    client_name: "Cursor",
    redirect_uris: [TEST_REDIRECT, "cursor://anysphere.cursor-mcp/oauth/callback"],
    created_at: "2026-06-01T12:00:00.000Z",
  });
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function params(extra: Record<string, string> = {}): URLSearchParams {
  const { challenge } = pkcePair();
  const base = new URLSearchParams({
    response_type: "code",
    client_id: `tsc_${"ab".repeat(16)}`,
    redirect_uri: TEST_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "ok",
  });
  for (const [key, value] of Object.entries(extra)) base.set(key, value);
  return base;
}

describe("beginAuthorization", () => {
  it("returns 400 JSON and no redirect for a bad client or redirect", async () => {
    const missing = await beginAuthorization(params({ client_id: "nope" }));
    expect(missing).toEqual({
      kind: "json",
      status: 400,
      error: "invalid_request",
      description: "The client or redirect URI is not valid.",
    });
    const unknown = await beginAuthorization(params({ redirect_uri: "https://evil.example/callback" }));
    expect(unknown.kind).toBe("json");
    expect(bridge.admin!.tables.mcp_oauth_requests).toHaveLength(0);
  });

  it("redirects later errors with error and state", async () => {
    const plain = await beginAuthorization(params({ code_challenge_method: "plain" }));
    expect(plain.kind).toBe("redirect");
    if (plain.kind !== "redirect") return;
    const plainUrl = new URL(plain.location);
    expect(plainUrl.searchParams.get("error")).toBe("invalid_request");
    expect(plainUrl.searchParams.get("state")).toBe("ok");
    expect(plainUrl.searchParams.get("iss")).toBe(TEST_ORIGIN);

    const missing = await beginAuthorization(params({ code_challenge: "", code_challenge_method: "" }));
    expect(missing.kind).toBe("redirect");

    const scope = await beginAuthorization(params({ scope: "read admin" }));
    expect(scope.kind).toBe("redirect");
    if (scope.kind === "redirect") expect(new URL(scope.location).searchParams.get("error")).toBe("invalid_scope");

    const target = await beginAuthorization(params({ resource: "https://evil.example/api/v1/mcp" }));
    expect(target.kind).toBe("redirect");
    if (target.kind === "redirect") expect(new URL(target.location).searchParams.get("error")).toBe("invalid_target");
  });

  it("stores a request when the client and redirect match", async () => {
    const result = await beginAuthorization(params());
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.location.startsWith(`${TEST_ORIGIN}/oauth/consent/`)).toBe(true);
    expect(bridge.admin!.tables.mcp_oauth_requests).toHaveLength(1);
    expect(bridge.admin!.tables.mcp_oauth_requests[0].resource).toBe(`${TEST_ORIGIN}/api/v1/mcp`);
    expect(bridge.admin!.tables.mcp_oauth_requests[0].scopes).toEqual(["read"]);
  });

  it("drops an oversized state instead of echoing it", async () => {
    const huge = "s".repeat(501);
    const result = await beginAuthorization(params({ state: huge }));
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(new URL(result.location).searchParams.get("state")).toBe("");
    expect(result.location).not.toContain(huge);
  });

  it("maps a missing table to unavailable without database text", async () => {
    bridge.admin!.missingTables.add("mcp_oauth_clients");
    await expect(beginAuthorization(params())).rejects.toBeInstanceOf(OAuthUnavailableError);
    expect(SECRET_DB).toBe("secret-db-text");
  });
});
