// Integration test for getEffectiveRole + nav helpers.
//
// The previous role-awareness fix shipped with 16 unit tests for the pure
// helper in lib/nav/items.ts but no test that exercised getEffectiveRole
// against the cookie + DB query interplay. That gap is what this file
// closes — the regression scenario is "brand-only user with a stale
// taylslate_view_as=show cookie": the cookie should be ignored and the
// stale flag should be set so the layout can self-heal.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromBuilder, supabaseClient, cookieStore, getUser } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  const store = { get: vi.fn() };
  const getUser = vi.fn();
  return {
    fromBuilder: builder,
    supabaseClient: { from: vi.fn(() => builder), auth: { getUser } },
    cookieStore: store,
    getUser,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supabaseClient),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { getEffectiveRole } from "./queries";
import {
  getNavItemsForRole,
  isRouteAllowedForRole,
} from "@/lib/nav/items";

interface State {
  profileRole: "brand" | "show" | "agent" | "agency" | null;
  hasBrandProfile: boolean;
  hasShowProfile: boolean;
  viewAsCookie?: "brand" | "show" | string;
}

function arrange(state: State) {
  // First call: profiles row.
  const profileResult =
    state.profileRole === null
      ? { data: null, error: null }
      : { data: { role: state.profileRole }, error: null };
  fromBuilder.single.mockResolvedValue(profileResult);

  // Subsequent calls: brand_profiles, show_profiles (in that order, per
  // Promise.all in getEffectiveRole).
  fromBuilder.maybeSingle
    .mockResolvedValueOnce(
      state.hasBrandProfile
        ? { data: { id: "bp1" }, error: null }
        : { data: null, error: null }
    )
    .mockResolvedValueOnce(
      state.hasShowProfile
        ? { data: { id: "sp1" }, error: null }
        : { data: null, error: null }
    );

  cookieStore.get.mockReturnValue(
    state.viewAsCookie ? { value: state.viewAsCookie } : undefined
  );
}

describe("getEffectiveRole — integration with cookies + DB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromBuilder.maybeSingle.mockReset();
    delete process.env.INTERNAL_ADMIN_EMAILS;
    getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("brand-only user, no cookie → effectiveRole=brand, no Shows in nav, /shows blocked", async () => {
    arrange({ profileRole: "brand", hasBrandProfile: true, hasShowProfile: false });
    const r = await getEffectiveRole("u1");

    expect(r).not.toBeNull();
    expect(r!.effectiveRole).toBe("brand");
    expect(r!.staleViewAs).toBe(false);
    expect(r!.canSwitchTo).toBeNull();

    const navHrefs = getNavItemsForRole(r!.effectiveRole).map((n) => n.href);
    expect(navHrefs).not.toContain("/shows");
    expect(isRouteAllowedForRole("/shows", r!.effectiveRole)).toBe(false);
    expect(isRouteAllowedForRole("/campaigns", r!.effectiveRole)).toBe(true);
  });

  it("brand-only user with stale show cookie → still brand, staleViewAs=true", async () => {
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: false,
      viewAsCookie: "show",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.staleViewAs).toBe(true);

    const navHrefs = getNavItemsForRole(r!.effectiveRole).map((n) => n.href);
    expect(navHrefs).not.toContain("/shows");
    expect(isRouteAllowedForRole("/shows", r!.effectiveRole)).toBe(false);
  });

  it("show-only user, no cookie → effectiveRole=show, no Campaigns in nav, /campaigns blocked", async () => {
    arrange({ profileRole: "show", hasBrandProfile: false, hasShowProfile: true });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("show");
    expect(r!.staleViewAs).toBe(false);

    const navHrefs = getNavItemsForRole(r!.effectiveRole).map((n) => n.href);
    expect(navHrefs).not.toContain("/campaigns");
    expect(isRouteAllowedForRole("/campaigns", r!.effectiveRole)).toBe(false);
    expect(isRouteAllowedForRole("/shows", r!.effectiveRole)).toBe(true);
  });

  it("show-only user with stale brand cookie → still show, staleViewAs=true", async () => {
    arrange({
      profileRole: "show",
      hasBrandProfile: false,
      hasShowProfile: true,
      viewAsCookie: "brand",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("show");
    expect(r!.staleViewAs).toBe(true);
  });

  it("dual profile, no cookie, brand account → brand chrome, canSwitchTo=show", async () => {
    arrange({ profileRole: "brand", hasBrandProfile: true, hasShowProfile: true });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.canSwitchTo).toBe("show");
    expect(r!.staleViewAs).toBe(false);
    expect(getNavItemsForRole(r!.effectiveRole).map((n) => n.href)).toContain("/campaigns");
  });

  it("dual profile + show cookie → flips to show and offers a return to brand", async () => {
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: true,
      viewAsCookie: "show",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("show");
    expect(r!.canSwitchTo).toBe("brand");
    expect(r!.staleViewAs).toBe(false);
    expect(getNavItemsForRole(r!.effectiveRole).map((n) => n.href)).toContain("/shows");
  });

  it("dual profile + brand cookie → stays brand, canSwitchTo=show", async () => {
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: true,
      viewAsCookie: "brand",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.canSwitchTo).toBe("show");
    expect(r!.staleViewAs).toBe(false);
  });

  it("show account with both profiles → show chrome, canSwitchTo=brand", async () => {
    arrange({ profileRole: "show", hasBrandProfile: true, hasShowProfile: true });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("show");
    expect(r!.canSwitchTo).toBe("brand");
    expect(getNavItemsForRole(r!.effectiveRole).map((n) => n.href)).toContain("/shows");
  });

  it("show account with both profiles + brand cookie → brand chrome, canSwitchTo=show", async () => {
    arrange({
      profileRole: "show",
      hasBrandProfile: true,
      hasShowProfile: true,
      viewAsCookie: "brand",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.canSwitchTo).toBe("show");
    expect(r!.staleViewAs).toBe(false);
    expect(getNavItemsForRole(r!.effectiveRole).map((n) => n.href)).toContain("/campaigns");
  });

  it("no profile row at all → null", async () => {
    arrange({ profileRole: null, hasBrandProfile: false, hasShowProfile: false });
    const r = await getEffectiveRole("u1");
    expect(r).toBeNull();
  });

  it("ignores a forged admin view cookie without an admin session", async () => {
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: false,
      viewAsCookie: "test:show1",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.adminViewLabel).toBeNull();
    expect(r!.staleViewAs).toBe(true);
    expect(isRouteAllowedForRole("/shows", r!.effectiveRole)).toBe(false);
    expect(getUser).toHaveBeenCalled();
  });

  it("ignores a forged admin view cookie from a signed-in non-admin", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "admin@taylslate.com";
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "person@example.com" } },
      error: null,
    });
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: false,
      viewAsCookie: "test:show1",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.adminViewLabel).toBeNull();
    expect(r!.staleViewAs).toBe(true);
  });

  it("lets an admin view point at Test Show 1 without a show profile", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "admin@taylslate.com";
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "admin@taylslate.com" } },
      error: null,
    });
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: false,
      viewAsCookie: "test:show1",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("show");
    expect(r!.adminViewLabel).toBe("Test Show 1");
    expect(r!.staleViewAs).toBe(false);
    expect(getNavItemsForRole(r!.effectiveRole).map((n) => n.href)).toContain("/shows");
  });

  it("lets an admin view point at Test Brand 1", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "admin@taylslate.com";
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "admin@taylslate.com" } },
      error: null,
    });
    arrange({
      profileRole: "show",
      hasBrandProfile: false,
      hasShowProfile: true,
      viewAsCookie: "test:brand1",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.adminViewLabel).toBe("Test Brand 1");
    expect(r!.staleViewAs).toBe(false);
    expect(isRouteAllowedForRole("/campaigns", r!.effectiveRole)).toBe(true);
  });

  it("lets an admin view point at Test Agent 1", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "admin@taylslate.com";
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "admin@taylslate.com" } },
      error: null,
    });
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: false,
      viewAsCookie: "test:agent1",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("agent");
    expect(r!.adminViewLabel).toBe("Test Agent 1");
    expect(r!.staleViewAs).toBe(false);
    expect(isRouteAllowedForRole("/shows", r!.effectiveRole)).toBe(true);
    expect(isRouteAllowedForRole("/campaigns", r!.effectiveRole)).toBe(false);
  });

  it("ignores an admin view cookie when the session user is someone else", async () => {
    process.env.INTERNAL_ADMIN_EMAILS = "admin@taylslate.com";
    getUser.mockResolvedValue({
      data: { user: { id: "other", email: "admin@taylslate.com" } },
      error: null,
    });
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: false,
      viewAsCookie: "test:show1",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("brand");
    expect(r!.staleViewAs).toBe(true);
  });
});
