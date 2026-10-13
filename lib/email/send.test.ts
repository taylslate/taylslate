import { beforeEach, describe, expect, it, vi } from "vitest";

const { resendSend, from } = vi.hoisted(() => ({
  resendSend: vi.fn(),
  from: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from },
}));

import { resolveManagedDelivery, sendEmail } from "./send";

function stageLookup(row: { email: string; is_managed: boolean } | null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.ilike.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({ data: row, error: null });
  builder.limit.mockResolvedValue({
    data: row ? [row] : [],
    error: null,
  });
  from.mockReturnValue(builder);
  return builder;
}

const message = {
  to: "brand@x.com",
  subject: "IO ready",
  html: "<p>Hi</p>",
  text: "Hi",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  process.env.MANAGED_ACCOUNT_INBOX = "ops@taylslate.com";
  resendSend.mockResolvedValue({ data: { id: "msg_1" }, error: null });
});

describe("sendEmail managed reroute", () => {
  it("sends a managed brand to MANAGED_ACCOUNT_INBOX and notes the original address", async () => {
    stageLookup({ email: "brand@x.com", is_managed: true });
    const result = await sendEmail({ ...message, recipientProfileId: "brand_1" });
    expect(result).toEqual({ ok: true, id: "msg_1" });
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@taylslate.com",
        subject: "[managed: brand@x.com] IO ready",
        html: "<p>Hi</p>",
        text: "Hi",
      }),
    );
  });

  it("looks the recipient up by email when no profile id is passed", async () => {
    const builder = stageLookup({ email: "brand@x.com", is_managed: true });
    await sendEmail(message);
    expect(builder.ilike).toHaveBeenCalledWith("email", "brand@x.com");
    expect(resendSend.mock.calls[0][0].to).toBe("ops@taylslate.com");
  });

  it("skips the send and does not call Resend when the inbox is unset", async () => {
    delete process.env.MANAGED_ACCOUNT_INBOX;
    stageLookup({ email: "brand@x.com", is_managed: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sendEmail({ ...message, recipientProfileId: "brand_1" });
    expect(result).toEqual({ ok: false, reason: "managed_inbox_unset" });
    expect(resendSend).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves an unmanaged brand unchanged", async () => {
    stageLookup({ email: "brand@x.com", is_managed: false });
    const result = await sendEmail({ ...message, recipientProfileId: "brand_1" });
    expect(result.ok).toBe(true);
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "brand@x.com",
        subject: "IO ready",
      }),
    );
  });

  it("sends a magic link to the real address even when the profile is managed", async () => {
    stageLookup({ email: "brand@x.com", is_managed: true });
    const result = await sendEmail({
      ...message,
      subject: "Log in to Taylslate",
      bypassManagedReroute: true,
    });
    expect(result.ok).toBe(true);
    expect(from).not.toHaveBeenCalled();
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "brand@x.com",
        subject: "Log in to Taylslate",
      }),
    );
  });
});

describe("resolveManagedDelivery", () => {
  it("reports a skip when the managed inbox is unset", async () => {
    delete process.env.MANAGED_ACCOUNT_INBOX;
    stageLookup({ email: "brand@x.com", is_managed: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      resolveManagedDelivery({ to: "brand@x.com", subject: "IO", recipientProfileId: "b1" }),
    ).resolves.toEqual({ ok: false, reason: "managed_inbox_unset" });
  });
});
