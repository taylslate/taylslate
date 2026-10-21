import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { resendSend, resolveManagedDelivery } = vi.hoisted(() => ({
  resendSend: vi.fn(),
  resolveManagedDelivery: vi.fn(),
}));

vi.mock("@/lib/email/send", () => ({
  resolveManagedDelivery: (...a: unknown[]) => resolveManagedDelivery(...a),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
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

function post(drafts: unknown[] = [draft]): NextRequest {
  return new NextRequest("http://x/api/campaigns/outreach/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ drafts }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  resendSend.mockResolvedValue({ data: { id: "msg" }, error: null });
});

describe("POST /api/campaigns/outreach/send", () => {
  it("sends an unmanaged recipient to the original address", async () => {
    resolveManagedDelivery.mockImplementation(
      async (input: { to: string; subject: string }) => ({
        ok: true,
        to: input.to,
        subject: input.subject,
      }),
    );

    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { show_id: "show-1", success: true, to: "brand@x.com" },
    ]);
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
      to: "ops@taylslate.com",
    });

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
    expect(body.results[0].error).toMatch(/MANAGED_ACCOUNT_INBOX/);
    expect(resendSend).not.toHaveBeenCalled();
  });
});
