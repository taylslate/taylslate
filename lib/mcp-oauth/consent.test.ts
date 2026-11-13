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

import { decideConsent, loadConsentView, PLAN_COPY } from "./consent";
import { _setOauthClockForTests } from "./config";
import { TEST_ORIGIN, TEST_REDIRECT, TEST_USER, createOauthTestAdmin, installOauthEnv, pkcePair } from "./test-store";

const SAVED_SITE = process.env.NEXT_PUBLIC_SITE_URL;
const CLIENT = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  bridge.admin = createOauthTestAdmin();
  installOauthEnv();
  _setOauthClockForTests(() => new Date("2026-06-01T12:00:00.000Z"));
  const { challenge } = pkcePair();
  bridge.admin.tables.mcp_oauth_clients.push({
    id: CLIENT,
    client_id: `tsc_${"ab".repeat(16)}`,
    client_name: "<script>alert(1)</script>",
    redirect_uris: [TEST_REDIRECT],
  });
  bridge.admin.tables.mcp_oauth_requests.push({
    id: REQUEST,
    client_id: CLIENT,
    redirect_uri: TEST_REDIRECT,
    scopes: ["read", "write:outreach"],
    state: "stay",
    code_challenge: challenge,
    resource: `${TEST_ORIGIN}/api/v1/mcp`,
    expires_at: "2026-06-01T12:10:00.000Z",
    consumed_at: null,
  });
  bridge.admin.tables.profiles.push({ id: TEST_USER, role: "brand", plan: "operator" });
  bridge.admin.user = { id: TEST_USER };
});

afterEach(() => {
  _setOauthClockForTests(null);
  if (SAVED_SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SAVED_SITE;
});

describe("consent", () => {
  it("shows the client name as text for an operator brand", async () => {
    const view = await loadConsentView(REQUEST, TEST_USER);
    expect(view).toMatchObject({
      state: "ready",
      clientName: "<script>alert(1)</script>",
      redirectHost: "app.example",
      scopes: ["read", "write:outreach"],
    });
  });

  it("uses one expired state for a missing, expired, or consumed request", async () => {
    expect(await loadConsentView("not-a-uuid", TEST_USER)).toEqual({ state: "expired" });
    bridge.admin!.tables.mcp_oauth_requests[0].expires_at = "2026-06-01T11:00:00.000Z";
    expect(await loadConsentView(REQUEST, TEST_USER)).toEqual({ state: "expired" });
    bridge.admin!.tables.mcp_oauth_requests[0].expires_at = "2026-06-01T12:10:00.000Z";
    bridge.admin!.tables.mcp_oauth_requests[0].consumed_at = "2026-06-01T12:01:00.000Z";
    expect(await loadConsentView(REQUEST, TEST_USER)).toEqual({ state: "expired" });
  });

  it("denies with access_denied and consumes the request once", async () => {
    const denied = await decideConsent(TEST_USER, { requestId: REQUEST, decision: "deny" });
    const url = new URL(denied.redirect);
    expect(url.origin + url.pathname).toBe(TEST_REDIRECT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("stay");
    expect(url.searchParams.get("iss")).toBe(TEST_ORIGIN);
    expect(bridge.admin!.tables.mcp_oauth_codes).toHaveLength(0);
    await expect(decideConsent(TEST_USER, { requestId: REQUEST, decision: "allow" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("does not mint a code for a non-brand or a plan without API access", async () => {
    bridge.admin!.tables.profiles[0].role = "show";
    await expect(decideConsent(TEST_USER, { requestId: REQUEST, decision: "allow" })).rejects.toMatchObject({
      status: 403,
      description: PLAN_COPY,
    });
    expect(bridge.admin!.tables.mcp_oauth_codes).toHaveLength(0);
    expect(bridge.admin!.tables.mcp_oauth_requests[0].consumed_at).toBeTruthy();

    bridge.admin!.tables.mcp_oauth_requests[0].consumed_at = null;
    bridge.admin!.tables.profiles[0].role = "brand";
    bridge.admin!.tables.profiles[0].plan = "starter";
    await expect(decideConsent(TEST_USER, { requestId: REQUEST, decision: "allow" })).rejects.toMatchObject({
      description: PLAN_COPY,
    });
    expect(bridge.admin!.tables.mcp_oauth_codes).toHaveLength(0);
    expect(SECRET_DB).toBe("secret-db-text");
  });

  it("omits a missing state and echoes a sent state on deny and allow", async () => {
    bridge.admin!.tables.mcp_oauth_requests[0].state = null;
    const denied = await decideConsent(TEST_USER, { requestId: REQUEST, decision: "deny" });
    const deniedUrl = new URL(denied.redirect);
    expect(deniedUrl.searchParams.has("state")).toBe(false);
    expect(denied.redirect).not.toContain("state=");
    expect(deniedUrl.searchParams.get("iss")).toBe(TEST_ORIGIN);
    expect(deniedUrl.searchParams.get("error")).toBe("access_denied");

    bridge.admin!.tables.mcp_oauth_requests[0].consumed_at = null;
    bridge.admin!.tables.mcp_oauth_requests[0].state = "stay exactly";
    const allowed = await decideConsent(TEST_USER, { requestId: REQUEST, decision: "allow" });
    const allowedUrl = new URL(allowed.redirect);
    expect(allowedUrl.searchParams.get("state")).toBe("stay exactly");
    expect(allowedUrl.searchParams.get("iss")).toBe(TEST_ORIGIN);
    expect(allowedUrl.searchParams.get("code")).toMatch(/^tsac_[0-9a-f]{64}$/);
  });

  it("allows once and a second submit does not mint another code", async () => {
    const allowed = await decideConsent(TEST_USER, { requestId: REQUEST, decision: "allow" });
    expect(new URL(allowed.redirect).searchParams.get("code")).toMatch(/^tsac_[0-9a-f]{64}$/);
    expect(bridge.admin!.tables.mcp_oauth_codes).toHaveLength(1);
    await expect(decideConsent(TEST_USER, { requestId: REQUEST, decision: "allow" })).rejects.toMatchObject({
      status: 400,
    });
    expect(bridge.admin!.tables.mcp_oauth_codes).toHaveLength(1);
  });
});
