import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyMagicLinkToken, createUser, generateLink, from, rpc, profiles, authDirectory } = vi.hoisted(
  () => ({
    verifyMagicLinkToken: vi.fn(),
    createUser: vi.fn(),
    generateLink: vi.fn(),
    from: vi.fn(),
    rpc: vi.fn(),
    profiles: { current: [] as { id: string; email: string }[] },
    authDirectory: { current: [] as { id: string; email: string }[] },
  }),
);

vi.mock("@/lib/io/tokens", () => ({
  verifyMagicLinkToken: (...args: unknown[]) => verifyMagicLinkToken(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc,
    from,
    auth: { admin: { createUser, generateLink } },
  },
}));

import { GET } from "./route";

beforeEach(() => {
  verifyMagicLinkToken.mockReset();
  createUser.mockReset();
  generateLink.mockReset();
  from.mockReset();
  rpc.mockReset();
  profiles.current = [{ id: "attacker-1", email: "victim@show.test" }];
  authDirectory.current = [{ id: "victim-1", email: "victim@show.test" }];
  rpc.mockImplementation(async (name: string, args: { lookup?: string }) => {
    if (name === "rate_limit_hit") return { data: true, error: null };
    if (name === "auth_user_ids_for_email") {
      const lookup = String(args.lookup ?? "").toLowerCase();
      return {
        data: authDirectory.current
          .filter((user) => user.email.toLowerCase() === lookup)
          .map((user) => user.id),
        error: null,
      };
    }
    return { data: null, error: { message: "unexpected rpc" } };
  });
  createUser.mockResolvedValue({ data: { user: { id: "created-1" } }, error: null });
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "tok-hash" }, user: { id: "victim-1" } },
    error: null,
  });
  from.mockImplementation(() => {
    const filters: Record<string, string> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return chain;
      },
      maybeSingle: async () => ({
        data: profiles.current.find((row) => row.email === filters.email) ?? null,
        error: null,
      }),
      insert: async () => ({ error: null }),
    };
    return chain;
  });
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

function request(token: string): NextRequest {
  return new NextRequest(`https://www.taylslate.com/api/auth/magic?token=${token}`);
}

describe("GET /api/auth/magic", () => {
  it("signs in the auth user when profiles.email was set to the same address", async () => {
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: "https://www.taylslate.com/outreach/tok",
    });
    const res = await GET(request("pitch-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("token_hash=tok-hash");
    expect(createUser).not.toHaveBeenCalled();
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "victim@show.test" }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("creates the auth user when only a profile row has that email", async () => {
    authDirectory.current = [];
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: "https://www.taylslate.com/outreach/tok",
    });
    const res = await GET(request("pitch-token"));
    expect(res.status).toBe(307);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "victim@show.test" }),
    );
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "victim@show.test" }),
    );
  });
});
