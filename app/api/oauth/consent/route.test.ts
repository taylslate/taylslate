import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OauthTestAdmin } from "@/lib/mcp-oauth/test-store";
import { SECRET_DB } from "@/lib/mcp-oauth/test-store";

const bridge = vi.hoisted(() => ({ admin: null as OauthTestAdmin | null }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (table: string) => bridge.admin!.from(table),
    rpc: (name: string, args: Record<string, unknown>) => bridge.admin!.rpc(name, args),
  },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => Promise.resolve(bridge.admin!.user),
}));

import { POST } from "./route";
import { TEST_ORIGIN, TEST_USER, createOauthTestAdmin, installOauthEnv, jsonPost } from "@/lib/mcp-oauth/test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;
const REQUEST = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
  bridge.admin.user = { id: TEST_USER };
});

afterEach(() => {
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

function post(headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    jsonPost(
      "https://www.taylslate.com/api/oauth/consent",
      { requestId: REQUEST, decision: "deny" },
      headers
    )
  );
}

describe("POST /api/oauth/consent", () => {
  it("returns 401 without a session and 403 for a foreign Origin", async () => {
    bridge.admin!.user = null;
    const signedOut = await post();
    expect(signedOut.status).toBe(401);
    expect((await signedOut.json()).error).toBe("invalid_request");

    bridge.admin!.user = { id: TEST_USER };
    const foreign = await post({ origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(JSON.stringify(await foreign.json())).not.toContain(SECRET_DB);
  });

  it("answers 429 when the rule is hit and 503 when the store errors", async () => {
    bridge.admin!.denyBuckets.add("mcp_oauth_consent_user_hour");
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many requests. Try again later." });

    bridge.admin = createOauthTestAdmin();
    installOauthEnv();
    bridge.admin.user = { id: TEST_USER };
    bridge.admin.rateError = { code: "XX000", message: SECRET_DB };
    const closed = await post();
    expect(closed.status).toBe(503);
    const body = await closed.json();
    expect(body).toEqual({ error: "unavailable" });
    expect(JSON.stringify(body)).not.toContain(SECRET_DB);
  });

  it("answers 503 temporarily_unavailable when the origin is missing", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const response = await post();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("temporarily_unavailable");
    expect(TEST_ORIGIN).toBe("https://www.taylslate.com");
  });
});
