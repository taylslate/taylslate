import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const admin = vi.fn();
const limit = vi.fn();
const list = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: () => auth(),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => admin(...args),
}));

vi.mock("@/lib/security/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/rate-limit")>("@/lib/security/rate-limit");
  return { ...actual, enforceRules: (...args: unknown[]) => limit(...args) };
});

vi.mock("@/lib/ownership/review", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownership/review")>("@/lib/ownership/review");
  return { ...actual, listOwnershipQueue: (...args: unknown[]) => list(...args) };
});

import { GET } from "./route";
import { OWNERSHIP_ERRORS } from "@/lib/ownership/check";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function get(status?: string): Promise<Response> {
  const url = status ? `https://www.taylslate.com/api/admin/ownership?status=${status}` : "https://www.taylslate.com/api/admin/ownership";
  return GET(new NextRequest(url));
}

describe("GET /api/admin/ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ id: ADMIN });
    admin.mockResolvedValue(true);
    limit.mockResolvedValue(null);
    list.mockResolvedValue({ ok: true, proofs: [] });
  });

  it("returns 401, 403, 429, and a closed 503", async () => {
    auth.mockResolvedValueOnce(null);
    const signedOut = await get();
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: "Unauthorized" });
    expect(signedOut.headers.get("Cache-Control")).toBe("no-store");
    expect(admin).not.toHaveBeenCalled();

    admin.mockResolvedValueOnce(false);
    const forbidden = await get();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });
    expect(forbidden.headers.get("Cache-Control")).toBe("no-store");
    expect(list).not.toHaveBeenCalled();

    limit.mockResolvedValueOnce(
      NextResponse.json({ error: OWNERSHIP_ERRORS.rate }, { status: 429, headers: { "Retry-After": "60" } })
    );
    const limited = await get();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(list).not.toHaveBeenCalled();

    limit.mockResolvedValueOnce(NextResponse.json({ error: "unavailable" }, { status: 503 }));
    const closed = await get();
    expect(closed.status).toBe(503);
    expect(await closed.json()).toEqual({ error: "unavailable" });
    expect(closed.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the queue and a fixed 400 for a bad status", async () => {
    const ok = await get("contested");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(list).toHaveBeenCalledWith({ status: "contested" });
    const bad = await get("verified");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Choose contested or expired." });
    expect(bad.headers.get("Cache-Control")).toBe("no-store");
  });
});
