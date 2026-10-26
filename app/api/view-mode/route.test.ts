import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { delete: vi.fn(), set: vi.fn(), get: vi.fn() };
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

import { GET, POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/view-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INTERNAL_ADMIN_EMAILS;
  cookieStore.get.mockReturnValue(undefined);
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  getBrandProfileByUserId.mockResolvedValue({ id: "bp1" });
  getShowProfileByUserId.mockResolvedValue({ id: "sp1" });
  getUserProfile.mockResolvedValue({ role: "brand" });
});

function asAdmin() {
  process.env.INTERNAL_ADMIN_EMAILS = "admin@taylslate.com";
  getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "admin@taylslate.com" } },
  });
}

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

  it("rejects agent for a non-admin", async () => {
    const res = await POST(post({ mode: "agent" }) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid mode" });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects a role the non-admin does not own", async () => {
    getShowProfileByUserId.mockResolvedValue(null);
    const res = await POST(post({ mode: "show" }) as never);
    expect(res.status).toBe(403);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("points an admin brand view at Test Brand 1", async () => {
    asAdmin();
    const res = await POST(post({ mode: "brand" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      viewAs: "brand",
      label: "Test Brand 1",
    });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "taylslate_view_as",
      "test:brand1",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });

  it("points an admin show view at Test Show 1", async () => {
    asAdmin();
    const res = await POST(post({ mode: "show" }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      viewAs: "show",
      label: "Test Show 1",
    });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "taylslate_view_as",
      "test:show1",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });

  it("rejects agent for an admin while no test agent is configured", async () => {
    asAdmin();
    const res = await POST(post({ mode: "agent" }) as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "No test agent configured" });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("returns the admin view only after the session admin check", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    const signedOut = await GET();
    expect(signedOut.status).toBe(401);

    cookieStore.get.mockReturnValue({ value: "test:show1" });
    const nonAdmin = await GET();
    expect(nonAdmin.status).toBe(200);
    expect(await nonAdmin.json()).toEqual({
      viewAs: null,
      label: null,
      agentConfigured: false,
    });

    asAdmin();
    const admin = await GET();
    expect(admin.status).toBe(200);
    expect(await admin.json()).toEqual({
      viewAs: "show",
      label: "Test Show 1",
      agentConfigured: false,
    });
  });
});
