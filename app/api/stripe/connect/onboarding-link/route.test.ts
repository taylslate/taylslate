import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression guard for the trailing-slash bug: the production
// NEXT_PUBLIC_SITE_URL carries a trailing slash, so interpolating it raw
// produced `//settings?...` in Stripe's refresh_url/return_url. The route now
// routes through siteOrigin(), which trims it — assert on the Stripe args.
const { getAuthenticatedUser, stripe, supabaseAdmin } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  stripe: { accountLinks: { create: vi.fn() } },
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/stripe/server", () => ({ stripe }));

import { POST } from "./route";

function req(): Request {
  return new Request("https://www.taylslate.com/api/stripe/connect/onboarding-link", {
    method: "POST",
  });
}

// Minimal from("profiles").select("*").eq("id", …).single() chain.
function mockProfile(profile: unknown, error: unknown = null) {
  supabaseAdmin.from.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: profile, error }),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.taylslate.com/";
});

describe("POST /api/stripe/connect/onboarding-link", () => {
  it("builds refresh_url/return_url with a single slash before settings", async () => {
    getAuthenticatedUser.mockResolvedValueOnce({ id: "user_1" });
    mockProfile({ stripe_connect_account_id: "acct_123" });
    stripe.accountLinks.create.mockResolvedValueOnce({
      url: "https://connect.stripe.com/setup/acct_123",
    });

    const res = await POST(req() as never);
    expect(res.status).toBe(200);

    expect(stripe.accountLinks.create).toHaveBeenCalledTimes(1);
    const args = stripe.accountLinks.create.mock.calls[0][0];
    expect(args).toMatchObject({
      account: "acct_123",
      refresh_url: "https://www.taylslate.com/settings?stripe_refresh=true",
      return_url: "https://www.taylslate.com/settings?stripe_onboarded=true",
      type: "account_onboarding",
    });
    // Explicit no-double-slash guard (the bug produced `//settings`).
    expect(args.refresh_url).not.toContain("//settings");
    expect(args.return_url).not.toContain("//settings");
  });
});
