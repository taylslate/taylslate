// Integration test for getEffectiveRole + nav helpers.
//
// The previous role-awareness fix shipped with 16 unit tests for the pure
// helper in lib/nav/items.ts but no test that exercised getEffectiveRole
// against the cookie + DB query interplay. That gap is what this file
// closes — the regression scenario is "brand-only user with a stale
// taylslate_view_as=show cookie": the cookie should be ignored and the
// stale flag should be set so the layout can self-heal.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromBuilder, supabaseClient, cookieStore } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };
  const store = { get: vi.fn() };
  return {
    fromBuilder: builder,
    supabaseClient: { from: vi.fn(() => builder) },
    cookieStore: store,
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

  it("dual profile + show cookie → flips to show, canSwitchTo=show", async () => {
    arrange({
      profileRole: "brand",
      hasBrandProfile: true,
      hasShowProfile: true,
      viewAsCookie: "show",
    });
    const r = await getEffectiveRole("u1");

    expect(r!.effectiveRole).toBe("show");
    expect(r!.canSwitchTo).toBe("show");
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

  it("no profile row at all → null", async () => {
    arrange({ profileRole: null, hasBrandProfile: false, hasShowProfile: false });
    const r = await getEffectiveRole("u1");
    expect(r).toBeNull();
  });
});
