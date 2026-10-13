import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, supabaseAdmin } = vi.hoisted(() => {
  function chain() {
    const b: Record<string, ReturnType<typeof vi.fn>> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.order = vi.fn(async () => ({ data: [], error: null }));
    b.in = vi.fn(async () => ({ data: [], error: null }));
    b.update = vi.fn(() => b);
    b.single = vi.fn(async () => ({ data: null, error: { message: "none" } }));
    return b;
  }
  const profiles = chain();
  const brandProfiles = chain();
  return {
    getAuthenticatedUser: vi.fn(),
    supabaseAdmin: {
      from: vi.fn((table: string) => (table === "brand_profiles" ? brandProfiles : profiles)),
      _profiles: profiles,
      _brandProfiles: brandProfiles,
    },
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { GET, PATCH } from "./route";

function patchReq(body: unknown): Request {
  return new Request("http://x/api/admin/managed-brands", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
});

describe("/api/admin/managed-brands", () => {
  it("returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 for a signed-in user who is not an internal admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "brand@x.com" });
    const getRes = await GET();
    expect(getRes.status).toBe(403);
    const patchRes = await PATCH(patchReq({ profileId: "p1", isManaged: true }) as never);
    expect(patchRes.status).toBe(403);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("lists brand profiles for an admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin", email: "ops@taylslate.com" });
    supabaseAdmin._profiles.order.mockResolvedValueOnce({
      data: [
        {
          id: "p1",
          email: "chris+brand1@taylslate.com",
          full_name: "Test",
          company_name: null,
          is_managed: false,
        },
      ],
      error: null,
    });
    supabaseAdmin._brandProfiles.in.mockResolvedValueOnce({
      data: [{ user_id: "p1", brand_name: "Test Brand 1", brand_identity: null }],
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brands).toEqual([
      {
        id: "p1",
        email: "chris+brand1@taylslate.com",
        name: "Test Brand 1",
        isManaged: false,
      },
    ]);
  });

  it("flips is_managed for an admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin", email: "ops@taylslate.com" });
    supabaseAdmin._profiles.single
      .mockResolvedValueOnce({
        data: { id: "p1", role: "brand", email: "chris+brand1@taylslate.com" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "p1", email: "chris+brand1@taylslate.com", is_managed: true },
        error: null,
      });

    const res = await PATCH(patchReq({ profileId: "p1", isManaged: true }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "p1",
      email: "chris+brand1@taylslate.com",
      isManaged: true,
    });
    expect(supabaseAdmin._profiles.update).toHaveBeenCalledWith({ is_managed: true });
  });
});
