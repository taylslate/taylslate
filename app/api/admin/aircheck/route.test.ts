import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, aircheckIoLine, AircheckLineNotFound } = vi.hoisted(() => {
  class AircheckLineNotFound extends Error {
    constructor(message?: string) {
      super(message);
      this.name = "AircheckLineNotFound";
    }
  }
  return {
    getAuthenticatedUser: vi.fn(),
    aircheckIoLine: vi.fn(),
    AircheckLineNotFound,
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/airchecks", () => ({
  aircheckIoLine: (...args: unknown[]) => aircheckIoLine(...args),
  AircheckLineNotFound,
}));

import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://x/api/admin/aircheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
});

describe("POST /api/admin/aircheck", () => {
  it("rejects unauthenticated callers", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never);
    expect(res.status).toBe(401);
    expect(aircheckIoLine).not.toHaveBeenCalled();
  });

  it("forbids users not on the allowlist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "random@notallowed.com",
    });
    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never);
    expect(res.status).toBe(403);
    expect(aircheckIoLine).not.toHaveBeenCalled();
  });

  it("rejects a missing ioLineItemId", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "ops@taylslate.com",
    });
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it("returns the stored transcript and its provider", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "ops@taylslate.com",
    });
    aircheckIoLine.mockResolvedValueOnce({
      id: "ac_1",
      io_line_item_id: "li_1",
      status: "transcribed",
      provider: "podscan",
      transcript_text: "the read",
      error: null,
      match_result: "matched",
    });
    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("podscan");
    expect(json.match).toBe("matched");
    expect(aircheckIoLine).toHaveBeenCalledWith("li_1");
  });

  it("reports a stored failure without treating it as an unhandled error", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "ops@taylslate.com",
    });
    aircheckIoLine.mockResolvedValueOnce({
      id: "ac_1",
      status: "failed",
      provider: null,
      match_result: "skipped",
      error: "Podscan returned no transcript and AIRCHECK_TRANSCRIPTION_PROVIDER is off",
    });
    const res = await POST(makeReq({ ioLineItemId: "li_1" }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.aircheck.status).toBe("failed");
  });

  it("returns 404 when the line does not exist", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({
      id: "u1",
      email: "ops@taylslate.com",
    });
    aircheckIoLine.mockRejectedValueOnce(new AircheckLineNotFound("missing"));
    const res = await POST(makeReq({ ioLineItemId: "missing" }) as never);
    expect(res.status).toBe(404);
  });
});
