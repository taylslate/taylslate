import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { delete: vi.fn(), set: vi.fn() };
const getUser = vi.fn();
const getBrandProfileByUserId = vi.fn();
const getShowProfileByUserId = vi.fn();
const getUserProfile = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));

vi.mock("@/lib/data/queries", () => ({
  VIEW_AS_COOKIE: "taylslate_view_as",
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  getShowProfileByUserId: (...args: unknown[]) => getShowProfileByUserId(...args),
  getUserProfile: (...args: unknown[]) => getUserProfile(...args),
}));

import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/view-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  getBrandProfileByUserId.mockResolvedValue({ id: "bp1" });
  getShowProfileByUserId.mockResolvedValue({ id: "sp1" });
  getUserProfile.mockResolvedValue({ role: "brand" });
});

describe("POST /api/view-mode", () => {
  it("clears the cookie when the target equals the account role", async () => {
    const res = await POST(post({ mode: "brand" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, viewAs: null });
    expect(cookieStore.delete).toHaveBeenCalledWith("taylslate_view_as");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("sets the cookie when the target is the other side", async () => {
    const res = await POST(post({ mode: "show" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, viewAs: "show" });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "taylslate_view_as",
      "show",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("sets the cookie when a show account switches to brand", async () => {
    getUserProfile.mockResolvedValue({ role: "show" });
    const res = await POST(post({ mode: "brand" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, viewAs: "brand" });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "taylslate_view_as",
      "brand",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("clears the cookie when a show account switches back to show", async () => {
    getUserProfile.mockResolvedValue({ role: "show" });
    const res = await POST(post({ mode: "show" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, viewAs: null });
    expect(cookieStore.delete).toHaveBeenCalledWith("taylslate_view_as");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
