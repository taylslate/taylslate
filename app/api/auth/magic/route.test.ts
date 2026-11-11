import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ONBOARDING_RETURN_COOKIE } from "@/lib/auth/onboarding-return";

const {
  verifyMagicLinkToken,
  verifyOutreachToken,
  getOutreachById,
  createUser,
  generateLink,
  from,
  rpc,
  insert,
  profiles,
  authDirectory,
} = vi.hoisted(() => ({
  verifyMagicLinkToken: vi.fn(),
  verifyOutreachToken: vi.fn(),
  getOutreachById: vi.fn(),
  createUser: vi.fn(),
  generateLink: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  profiles: { current: [] as { id: string; email: string }[] },
  authDirectory: { current: [] as { id: string; email: string }[] },
}));

vi.mock("@/lib/io/tokens", () => ({
  verifyMagicLinkToken: (...args: unknown[]) => verifyMagicLinkToken(...args),
  verifyOutreachToken: (...args: unknown[]) => verifyOutreachToken(...args),
}));

vi.mock("@/lib/data/queries", () => ({
  getOutreachById: (...args: unknown[]) => getOutreachById(...args),
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
  verifyOutreachToken.mockReset();
  getOutreachById.mockReset();
  createUser.mockReset();
  generateLink.mockReset();
  from.mockReset();
  rpc.mockReset();
  insert.mockReset();
  profiles.current = [{ id: "attacker-1", email: "victim@show.test" }];
  authDirectory.current = [{ id: "victim-1", email: "victim@show.test" }];
  verifyOutreachToken.mockReturnValue({ outreach_id: "out-1", iat: 1, v: 1 });
  getOutreachById.mockResolvedValue({
    id: "out-1",
    sent_to_email: "victim@show.test",
    show_name: "Daily",
    brand_profile_id: "bp-1",
  });
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
  insert.mockResolvedValue({ error: null });
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
      insert,
    };
    return chain;
  });
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

function request(token: string): NextRequest {
  return new NextRequest(`https://www.taylslate.com/api/auth/magic?token=${token}`);
}

function pitchReturn(token = "tok"): string {
  return `https://www.taylslate.com/outreach/${token}`;
}

async function expectRejected(): Promise<void> {
  const res = await GET(request("pitch-token"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toContain("/auth/magic?error=invalid_or_expired");
  expect(res.headers.get("location")).not.toContain("token_hash");
  expect(createUser).not.toHaveBeenCalled();
  expect(generateLink).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
  expect(res.cookies.get(ONBOARDING_RETURN_COOKIE)).toBeUndefined();
}

describe("GET /api/auth/magic", () => {
  it("signs in the auth user when profiles.email was set to the same address", async () => {
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: pitchReturn(),
    });
    const res = await GET(request("pitch-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("token_hash=tok-hash");
    expect(res.headers.get("location")).toContain("next=%2Fonboarding%2Fshow");
    expect(res.cookies.get(ONBOARDING_RETURN_COOKIE)?.value).toBe("/outreach/tok");
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
      return_url: pitchReturn(),
    });
    const res = await GET(request("pitch-token"));
    expect(res.status).toBe(307);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "victim@show.test" }),
    );
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "victim@show.test" }),
    );
    expect(res.cookies.get(ONBOARDING_RETURN_COOKIE)?.value).toBe("/outreach/tok");
  });

  it("signs in a matching recipient and sets the return cookie", async () => {
    getOutreachById.mockResolvedValue({
      id: "out-1",
      sent_to_email: " Victim@Show.test ",
      show_name: "Daily",
      brand_profile_id: "bp-1",
    });
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: pitchReturn("pitch-jwt"),
    });
    const res = await GET(request("pitch-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("token_hash=tok-hash");
    expect(res.headers.get("location")).toContain("next=%2Fonboarding%2Fshow");
    expect(res.cookies.get(ONBOARDING_RETURN_COOKIE)?.value).toBe("/outreach/pitch-jwt");
    expect(createUser).not.toHaveBeenCalled();
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "victim@show.test" }),
    );
  });

  it("refuses a magic email that is not the outreach recipient", async () => {
    getOutreachById.mockResolvedValue({
      id: "out-1",
      sent_to_email: "host@show.test",
      show_name: "Daily",
      brand_profile_id: "bp-1",
    });
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: pitchReturn(),
    });
    await expectRejected();
  });

  it("refuses a return url on another origin", async () => {
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: "https://evil.example/outreach/tok",
    });
    await expectRejected();
  });

  it("refuses a path that is not /outreach/<token>", async () => {
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: "https://www.taylslate.com/onboarding/show",
    });
    await expectRejected();
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: "https://www.taylslate.com/outreach/tok/extra",
    });
    await expectRejected();
  });

  it("refuses a bad outreach signature", async () => {
    verifyOutreachToken.mockReturnValue(null);
    verifyMagicLinkToken.mockReturnValue({
      email: "victim@show.test",
      return_url: pitchReturn(),
    });
    await expectRejected();
  });
});
