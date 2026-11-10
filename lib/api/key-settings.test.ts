import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ApiKeyRecord } from "@/lib/api/keys";

const session = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  profile: null as { role?: string; plan?: string | null } | null,
  error: null as { code?: string; message?: string } | null,
  select: "",
  queriedId: "",
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => session.user,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: (columns: string) => ({
        eq: (_column: string, id: string) => ({
          single: async () => {
            session.select = columns;
            session.queriedId = id;
            if (session.error) return { data: null, error: session.error };
            if (!session.profile) {
              return { data: null, error: { code: "PGRST116", message: "no rows" } };
            }
            return { data: session.profile, error: null };
          },
        }),
      }),
    }),
  }),
}));

import {
  ACTIVE_API_KEY_CAP_MESSAGE,
  API_KEY_RESPONSE_FIELDS,
  apiKeyCreateRules,
  apiKeyRevokeRules,
  assertSameOrigin,
  assertUnderActiveCap,
  brandHasApiAccess,
  KeySettingsError,
  loadBrandKeySettings,
  parseApiKeyCreateBody,
  readCreateBody,
  toApiKeyResponse,
} from "@/lib/api/key-settings";

const BRAND = "11111111-1111-4111-8111-111111111111";

function record(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    brandId: BRAND,
    name: "Media plan",
    prefix: "0123456789abcdef",
    scopes: ["read"],
    createdAt: "2026-11-01T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  session.user = { id: BRAND, email: "brand@example.com" };
  session.profile = { role: "brand", plan: "operator" };
  session.error = null;
  session.select = "";
  session.queriedId = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API key create body", () => {
  it("trims the name and dedupes scopes", () => {
    expect(
      parseApiKeyCreateBody({
        name: "  Planner  ",
        scopes: ["read", "read", "write:outreach"],
      })
    ).toEqual({
      name: "Planner",
      scopes: ["read", "write:outreach"],
    });
  });

  it("rejects a missing name, a long name, and a non-printable name", () => {
    expect(() => parseApiKeyCreateBody({ name: "   ", scopes: ["read"] })).toThrow(
      "Name is required."
    );
    expect(() =>
      parseApiKeyCreateBody({ name: "a".repeat(61), scopes: ["read"] })
    ).toThrow("Name must be 1 to 60 printable characters.");
    expect(() => parseApiKeyCreateBody({ name: "bad\nname", scopes: ["read"] })).toThrow(
      "Name must be 1 to 60 printable characters."
    );
    expect(() => parseApiKeyCreateBody({ scopes: ["read"] })).toThrow("Name is required.");
  });

  it("rejects an empty scope list and a scope that is not in API_SCOPES", () => {
    expect(() => parseApiKeyCreateBody({ name: "Planner", scopes: [] })).toThrow(
      "Choose at least one scope."
    );
    expect(() =>
      parseApiKeyCreateBody({ name: "Planner", scopes: ["campaigns:read"] })
    ).toThrow("Unknown API scope.");
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parseApiKeyCreateBody({
        name: "Planner",
        scopes: ["read"],
        brandId: "22222222-2222-4222-8222-222222222222",
      })
    ).toThrow("Unknown field brandId.");
  });

  it("rejects a body over the byte cap and a non-JSON mime", async () => {
    const huge = new NextRequest("https://www.taylslate.com/api/settings/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(9000), scopes: ["read"] }),
    });
    await expect(readCreateBody(huge)).rejects.toMatchObject({ status: 413 });

    const text = new NextRequest("https://www.taylslate.com/api/settings/api-keys", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "name=Planner",
    });
    await expect(readCreateBody(text)).rejects.toMatchObject({ status: 415 });
  });
});

describe("API key settings rules", () => {
  it("keys the create and revoke buckets by user id", () => {
    expect(apiKeyCreateRules(BRAND)).toEqual([
      {
        bucket: "api_key_create_user_hour",
        key: BRAND,
        max: 10,
        windowSeconds: 60 * 60,
      },
    ]);
    expect(apiKeyRevokeRules(BRAND)[0]).toMatchObject({
      bucket: "api_key_revoke_user_hour",
      key: BRAND,
      max: 30,
    });
    expect(JSON.stringify(apiKeyCreateRules(BRAND))).not.toContain("brand@example.com");
  });

  it("requires the Origin host to match the request host", () => {
    const same = new NextRequest("https://www.taylslate.com/api/settings/api-keys", {
      headers: { origin: "https://www.taylslate.com" },
    });
    expect(() => assertSameOrigin(same)).not.toThrow();

    const cross = new NextRequest("https://www.taylslate.com/api/settings/api-keys", {
      headers: { origin: "https://evil.example" },
    });
    expect(() => assertSameOrigin(cross)).toThrow(KeySettingsError);
    try {
      assertSameOrigin(cross);
    } catch (err) {
      expect(err).toMatchObject({ status: 403 });
    }

    const missing = new NextRequest("https://www.taylslate.com/api/settings/api-keys");
    expect(() => assertSameOrigin(missing)).toThrow(KeySettingsError);
  });

  it("counts only unrevoked keys toward the cap", () => {
    const active = Array.from({ length: 9 }, (_, index) =>
      record({ id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}` })
    );
    expect(() => assertUnderActiveCap(active)).not.toThrow();
    expect(() =>
      assertUnderActiveCap([
        ...active,
        record({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", revokedAt: "2026-01-01T00:00:00.000Z" }),
      ])
    ).not.toThrow();
    expect(() => assertUnderActiveCap([...active, record()])).toThrow(
      ACTIVE_API_KEY_CAP_MESSAGE
    );
  });

  it("maps a key to the response allowlist and drops the hash and secret", () => {
    const response = toApiKeyResponse({
      ...record(),
      secret: "ts_live_secret",
      key_hash: "abc",
    } as ApiKeyRecord & { secret: string; key_hash: string });
    expect(Object.keys(response)).toEqual([...API_KEY_RESPONSE_FIELDS]);
    const encoded = JSON.stringify(response);
    expect(encoded).not.toContain("key_hash");
    expect(encoded).not.toContain("ts_live_secret");
    expect(encoded).not.toContain(BRAND);
  });

  it("grants apiAccess only from the plan catalogue", () => {
    expect(brandHasApiAccess("operator")).toBe(true);
    expect(brandHasApiAccess("agency")).toBe(true);
    expect(brandHasApiAccess("pay_as_you_go")).toBe(false);
    expect(brandHasApiAccess("starter")).toBe(false);
    expect(brandHasApiAccess(null)).toBe(false);
    expect(brandHasApiAccess("toString")).toBe(false);
  });
});

describe("loadBrandKeySettings", () => {
  it("returns 401 when there is no session", async () => {
    session.user = null;
    await expect(loadBrandKeySettings()).rejects.toMatchObject({ status: 401 });
  });

  it("returns 403 for show and agent roles", async () => {
    session.profile = { role: "show", plan: "operator" };
    await expect(loadBrandKeySettings()).rejects.toMatchObject({ status: 403 });
    session.profile = { role: "agent", plan: "operator" };
    await expect(loadBrandKeySettings()).rejects.toMatchObject({ status: 403 });
  });

  it("reads role and plan by id and ignores the login email", async () => {
    const loaded = await loadBrandKeySettings();
    expect(loaded).toEqual({ brandId: BRAND, apiAccess: true });
    expect(session.select).toBe("role, plan");
    expect(session.select).not.toContain("email");
    expect(session.queriedId).toBe(BRAND);

    session.profile = { role: "brand", plan: "starter" };
    await expect(loadBrandKeySettings()).resolves.toEqual({
      brandId: BRAND,
      apiAccess: false,
    });
  });

  it("fails closed when the profile read errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    session.error = { code: "57014", message: "brand@example.com timeout" };
    await expect(loadBrandKeySettings()).rejects.toMatchObject({ status: 503 });
    expect(warn.mock.calls.join(" ")).not.toContain("brand@example.com");
  });
});
