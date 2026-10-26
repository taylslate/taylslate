import { describe, it, expect, vi, beforeEach } from "vitest";

const getAuthenticatedUser = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceUpload: vi.fn(async () => null),
}));

import { POST } from "./route";

function jsonRequest(body: unknown): Request {
  return new Request("http://x/api/show-profile/media-kit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/show-profile/media-kit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(jsonRequest({ text: "United States 62%" }) as never);
    expect(res.status).toBe(401);
  });

  it("parses pasted text and does not invent shares", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    const res = await POST(
      jsonRequest({ text: "United States 62%\nCanada 8%\nNorth America 80%" }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "United States 62%\nCanada 8%\nNorth America 80%",
      geography: { us: 62, canada: 8 },
    });
  });

  it("returns null geography when the text has no country breakdown", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1" });
    const res = await POST(jsonRequest({ text: "Host read, mid-roll, $25 CPM" }) as never);
    const body = await res.json();
    expect(body.geography).toBeNull();
  });
});
