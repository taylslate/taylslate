import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetAuthenticatedUser, mockRecord } = vi.hoisted(() => ({
  mockGetAuthenticatedUser: vi.fn(),
  mockRecord: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mockGetAuthenticatedUser,
}));

vi.mock("@/lib/data/reasoning-log", () => ({
  recordFounderAnnotation: mockRecord,
}));

// isInternalAdmin is the REAL helper — gated via INTERNAL_ADMIN_EMAILS below, so
// the test exercises the actual allowlist parse, not a stub.
import { POST } from "./route";

const ADMIN = { id: "u_admin", email: "admin@example.com" };
const BRAND = { id: "u_brand", email: "brand@example.com" };

function call(body: unknown, opts: { raw?: string } = {}) {
  return POST(
    new Request("http://x/api/admin/shows/show_1/annotations", {
      method: "POST",
      body: opts.raw ?? JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ showId: "show_1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "admin@example.com";
  mockGetAuthenticatedUser.mockResolvedValue(ADMIN);
  mockRecord.mockResolvedValue("anno_1");
});

describe("POST /api/admin/shows/[showId]/annotations", () => {
  it("401 when unauthenticated", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    const res = await call({ note: "n" });
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("403 when the user is not on the admin allowlist", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(BRAND);
    const res = await call({ note: "n" });
    expect(res.status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("400 on a missing/empty note", async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ note: "   " })).status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    const res = await call(undefined, { raw: "not json" });
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("201 + id on success, wiring author + show id", async () => {
    const res = await call({ note: "host uses it", tags: ["wellness"] });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({ ok: true, id: "anno_1" });
    expect(mockRecord).toHaveBeenCalledWith({
      showId: "show_1",
      authorId: "u_admin",
      note: "host uses it",
      tags: ["wellness"],
    });
  });

  it("sanitizes tags (trim, drop non-strings/empties, de-dupe case-insensitively)", async () => {
    await call({ note: "x", tags: [" A ", "a", 5, "", "B"] });
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["A", "B"] })
    );
  });

  it("500 when the write fails", async () => {
    mockRecord.mockResolvedValue(null);
    const res = await call({ note: "n" });
    expect(res.status).toBe(500);
  });
});
