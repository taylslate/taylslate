import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// proxy() builds a Supabase server client and calls getUser() to decide whether
// a request is authenticated. We stub createServerClient so we can drive the
// user state and assert the public-route allowlist independently of real auth.
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } })),
}));

import { proxy, redirectApexToWww } from "./proxy";

const run = (path: string) =>
  proxy(new NextRequest(`https://www.taylslate.com${path}`));
const redirectedToLogin = (res: Response) =>
  (res.headers.get("location") ?? "").includes("/login");

beforeEach(() => {
  // Signed out — the state under which the allowlist actually matters.
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("proxy public-route allowlist (signed out)", () => {
  for (const path of [
    "/signup",
    "/login",
    "/login/show",
    "/callback",
    "/forgot-password",
    "/reset-password",
    "/",
    "/for-shows",
    "/terms",
    "/privacy",
    "/sitemap.xml",
    "/robots.txt",
    "/opengraph-image",
  ]) {
    it(`allows ${path} without bouncing to /login`, async () => {
      const res = await run(path);
      expect(redirectedToLogin(res)).toBe(false);
    });
  }

  it("does not treat a longer /terms path as public", async () => {
    const res = await run("/terms/extra");
    expect(redirectedToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("next=%2Fterms%2Fextra");
  });

  it("does not treat /privacy/x as public", async () => {
    const res = await run("/privacy/x");
    expect(redirectedToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("next=%2Fprivacy%2Fx");
  });

  it("does not treat /terms-anything as public", async () => {
    const res = await run("/terms-anything");
    expect(redirectedToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("next=%2Fterms-anything");
  });

  it("still bounces a protected route to /login when signed out", async () => {
    const res = await run("/dashboard");
    expect(redirectedToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("next=%2Fdashboard");
  });

  it("bounces /admin to /login when signed out", async () => {
    const res = await run("/admin");
    expect(redirectedToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("next=%2Fadmin");
  });

  it("bounces the shows catalog to /login when signed out", async () => {
    const res = await run("/shows");
    expect(redirectedToLogin(res)).toBe(true);
    expect(res.headers.get("location")).toContain("next=%2Fshows");
  });
});

describe("proxy passes authenticated users through to protected routes", () => {
  it("lets a signed-in user reach /dashboard", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await run("/dashboard");
    expect(redirectedToLogin(res)).toBe(false);
  });

  it("lets a signed-in user reach /admin so the page can apply the admin gate", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await run("/admin");
    expect(redirectedToLogin(res)).toBe(false);
  });
});

describe("canonical host", () => {
  it("sends the bare domain to www and keeps the path and query", () => {
    const res = redirectApexToWww(
      new NextRequest("https://taylslate.com/api/youtube/callback?code=abc&state=xyz")
    );
    expect(res?.status).toBe(308);
    expect(res?.headers.get("location")).toBe(
      "https://www.taylslate.com/api/youtube/callback?code=abc&state=xyz"
    );
  });

  it("leaves www and other hosts alone", () => {
    expect(redirectApexToWww(new NextRequest("https://www.taylslate.com/settings/youtube"))).toBeNull();
    expect(redirectApexToWww(new NextRequest("http://localhost:3000/settings/youtube"))).toBeNull();
  });
});
