import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

const { resendSend, resolveManagedDelivery, getAuthenticatedUser, maybeSingle, rpc, showsById } = vi.hoisted(() => ({
  resendSend: vi.fn(),
  resolveManagedDelivery: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(async () => ({ data: true, error: null })),
  showsById: new Map<string, { id: string; contact_email: string | null }>(),
}));

vi.mock("@/lib/email/send", () => ({
  resolveManagedDelivery: (...a: unknown[]) => resolveManagedDelivery(...a),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));
vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc,
    from: (table: string) => {
      const filters: Array<{ op: "eq" | "in"; value: unknown }> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(_column: string, value: unknown) {
          filters.push({ op: "eq", value });
          return builder;
        },
        in(_column: string, value: unknown) {
          filters.push({ op: "in", value });
          return builder;
        },
        maybeSingle: async () => {
          if (table === "shows") {
            const id = filters.find((filter) => filter.op === "eq")?.value;
            return { data: typeof id === "string" ? showsById.get(id) ?? null : null, error: null };
          }
          return maybeSingle();
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          if (table === "shows") {
            const ids = filters.find((filter) => filter.op === "in")?.value;
            const data = Array.isArray(ids)
              ? ids.flatMap((id) => {
                  const row = typeof id === "string" ? showsById.get(id) : undefined;
                  return row ? [row] : [];
                })
              : [];
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  },
}));

import { POST } from "./route";

const draft = {
  show_id: "show-1",
  show_name: "The Daily Briefing",
  contact_email: "brand@x.com",
  subject: "A March test",
  body: "We would like to run a three-episode test in March.",
};

function ownedCampaign(userId = USER_ID) {
  return {
    data: {
      id: CAMPAIGN_ID,
      user_id: userId,
      recommendations: [{ show_id: "show-1", contact_email: "brand@x.com" }],
      youtube_recommendations: [],
      expansion_opportunities: [],
    },
    error: null,
  };
}

function post(drafts: unknown[] = [draft], raw?: string): NextRequest {
  return new NextRequest("http://x/api/campaigns/outreach/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify({ campaign_id: CAMPAIGN_ID, drafts }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  resendSend.mockResolvedValue({ data: { id: "msg" }, error: null });
  getAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  showsById.clear();
  maybeSingle.mockResolvedValue(ownedCampaign());
  resolveManagedDelivery.mockImplementation(
    async (input: { to: string; subject: string }) => ({
      ok: true,
      to: input.to,
      subject: input.subject,
    }),
  );
});

describe("POST /api/campaigns/outreach/send", () => {
  it("sends an unmanaged recipient to the original address", async () => {
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ show_id: "show-1", success: true }]);
    expect(body.results[0]).not.toHaveProperty("to");
    expect(resolveManagedDelivery).toHaveBeenCalledWith({
      to: "brand@x.com",
      subject: "A March test",
    });

    const sent = resendSend.mock.calls[0][0];
    expect(sent.from).toBe("Taylslate <outreach@taylslate.com>");
    expect(sent.to).toBe("brand@x.com");
    expect(sent.subject).toBe("A March test");
    expect(sent.html).toContain("A brand asked us to pass this along for The Daily Briefing");
    expect(sent.html).toContain("three-episode test");
  });

  it("reroutes a managed brand to MANAGED_ACCOUNT_INBOX", async () => {
    resolveManagedDelivery.mockResolvedValue({
      ok: true,
      to: "ops@taylslate.com",
      subject: "[managed: brand@x.com] A March test",
    });

    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({
      show_id: "show-1",
      success: true,
    });
    expect(body.results[0]).not.toHaveProperty("to");

    const sent = resendSend.mock.calls[0][0];
    expect(sent.to).toBe("ops@taylslate.com");
    expect(sent.subject).toBe("[managed: brand@x.com] A March test");
    expect(sent.from).toBe("Taylslate <outreach@taylslate.com>");
    expect(sent.html).toContain("three-episode test");
  });

  it("skips the send when the managed inbox is unset", async () => {
    resolveManagedDelivery.mockResolvedValue({
      ok: false,
      reason: "managed_inbox_unset",
    });

    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toBe(
      "This show is managed and MANAGED_ACCOUNT_INBOX is not set, so the email was not sent.",
    );
    expect(body.results[0].error).not.toMatch(/brand/i);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("returns 401 with no session", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(resendSend).not.toHaveBeenCalled();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("returns 403 for someone else's campaign", async () => {
    maybeSingle.mockResolvedValue(ownedCampaign("33333333-3333-4333-8333-333333333333"));
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("returns 400 over the caps", async () => {
    const tooMany = Array.from({ length: 51 }, () => draft);
    const many = await POST(post(tooMany));
    expect(many.status).toBe(400);

    const longSubject = await POST(post([{ ...draft, subject: "s".repeat(201) }]));
    expect(longSubject.status).toBe(400);

    const longBody = await POST(post([{ ...draft, body: "b".repeat(10 * 1024 + 1) }]));
    expect(longBody.status).toBe(400);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("returns 413 on an oversized body", async () => {
    const res = await POST(post([], "x".repeat(512 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("drops a recipient that is not on the campaign", async () => {
    const res = await POST(
      post([
        draft,
        {
          ...draft,
          show_id: "show-2",
          contact_email: "stranger@example.com",
          show_name: "Not On The Plan",
        },
      ]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({ show_id: "show-1", success: true });
    expect(body.results[0]).not.toHaveProperty("to");
    expect(body.results[1]).toMatchObject({
      show_id: "show-2",
      success: false,
    });
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0][0].to).toBe("brand@x.com");
  });

  it("does not send to a catalog show that is not on the campaign", async () => {
    const hidden = "66666666-6666-4666-8666-666666666666";
    showsById.set(hidden, { id: hidden, contact_email: "hidden@example.test" });
    const res = await POST(
      post([{ ...draft, show_id: hidden, contact_email: "attacker@example.test", show_name: "Hidden" }])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { show_id: hidden, success: false, error: "Recipient is not a contact on this campaign." },
    ]);
    expect(JSON.stringify(body)).not.toContain("hidden@example.test");
    expect(JSON.stringify(body)).not.toContain("attacker@example.test");
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("sends to a catalog show that is on the campaign", async () => {
    const listed = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    showsById.set(listed, { id: listed, contact_email: "host@example.test" });
    maybeSingle.mockResolvedValue({
      data: {
        id: CAMPAIGN_ID,
        user_id: USER_ID,
        selected_show_ids: [listed],
        recommendations: [],
        youtube_recommendations: [],
        expansion_opportunities: [],
      },
      error: null,
    });
    const res = await POST(
      post([{ ...draft, show_id: listed, contact_email: "attacker@example.test", show_name: "Daily" }])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ show_id: listed, success: true }]);
    expect(JSON.stringify(body)).not.toContain("host@example.test");
    expect(resendSend.mock.calls[0][0].to).toBe("host@example.test");
  });
});
