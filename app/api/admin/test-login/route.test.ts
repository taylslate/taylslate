import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { hashReturnToken, RETURN_TOKEN_COOKIE } from "@/lib/admin/return-token";

// Layer 3 addition under test: on a successful test-login, the route mints an
// opaque return token, persists only its sha256 hash on the admin.impersonate
// event, and sets the raw token in the httpOnly tslate_return_token cookie.
// hashReturnToken is the real helper, so we can prove the cookie value hashes to
// the stored payload hash.

const { generateLink } = vi.hoisted(() => ({ generateLink: vi.fn() }));

const getAuthenticatedUser = vi.fn();
const isInternalAdmin = vi.fn();
const logEvent = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { auth: { admin: { generateLink } } },
}));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
}));
vi.mock("@/lib/auth/admin", () => ({
  isInternalAdmin: (...a: unknown[]) => isInternalAdmin(...a),
}));
vi.mock("@/lib/data/events", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://x/api/admin/test-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "u-admin", email: "chris@taylslate.com" });
  isInternalAdmin.mockReturnValue(true);
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hashed-xyz" } },
    error: null,
  });
});

describe("POST /api/admin/test-login — return token minting", () => {
  it("stores the token hash on the impersonate event and sets the raw token cookie", async () => {
    const res = await POST(req({ key: "brand1" }));
    expect(res.status).toBe(200);

    // The impersonate event carries a sha256-hex hash, never the raw token.
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin.impersonate",
        payload: expect.objectContaining({
          return_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      })
    );

    // The cookie carries the raw token, and it hashes to exactly the stored hash.
    const cookieValue = res.cookies.get(RETURN_TOKEN_COOKIE)?.value;
    expect(cookieValue).toBeTruthy();
    const storedHash = logEvent.mock.calls[0][0].payload.return_token_hash;
    expect(hashReturnToken(cookieValue as string)).toBe(storedHash);
  });

  it("rejects a non-admin (403) and mints no token", async () => {
    isInternalAdmin.mockReturnValue(false);
    const res = await POST(req({ key: "brand1" }));
    expect(res.status).toBe(403);
    expect(logEvent).not.toHaveBeenCalled();
    expect(res.cookies.get(RETURN_TOKEN_COOKIE)?.value).toBeFalsy();
  });
});
