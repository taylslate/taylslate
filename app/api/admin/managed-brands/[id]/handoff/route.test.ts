import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OLD_EMAIL = "chris+brand1@taylslate.com";
const NEW_EMAIL = "owner@brand.com";

interface ProfileRow {
  id: string;
  email: string;
  role: string;
  is_managed: boolean;
}

interface DealRow {
  id: string;
  brand_id: string;
}
interface CampaignRow {
  id: string;
  user_id: string;
}
interface IoRow {
  id: string;
  deal_id: string;
}
interface OwnedRow {
  id: string;
  user_id: string;
}

const {
  getAuthenticatedUser,
  supabaseAdmin,
  state,
  writes,
  sendEmail,
  logEvent,
  updateUserById,
  getUserById,
  listUsers,
  generateLink,
} = vi.hoisted(() => {
  const state = {
    profiles: [] as ProfileRow[],
    deals: [] as DealRow[],
    campaigns: [] as CampaignRow[],
    insertion_orders: [] as IoRow[],
    brand_profiles: [] as OwnedRow[],
    outreaches: [] as { id: string; campaign_id: string }[],
    invoices: [] as OwnedRow[],
    payments: [] as OwnedRow[],
    authEmail: "",
    failProfileUpdate: false,
    authUpdateError: null as { message: string; code: string } | null,
  };
  const writes: string[] = [];

  function rowsFor(table: string): Record<string, unknown>[] {
    return (state as unknown as Record<string, Record<string, unknown>[]>)[table] ?? [];
  }

  function from(table: string) {
    const filters: { op: "eq" | "ilike"; col: string; val: unknown }[] = [];
    let patch: Record<string, unknown> | null = null;

    function matched() {
      return rowsFor(table).filter((row) =>
        filters.every((filter) => {
          const current = String(row[filter.col] ?? "");
          if (filter.op === "eq") return current === String(filter.val);
          const pattern = String(filter.val).replace(/\\([%_\\])/g, "$1");
          return current.toLowerCase() === pattern.toLowerCase();
        }),
      );
    }

    function execute(one: boolean) {
      const hits = matched();
      if (patch) {
        writes.push(table);
        if (table === "profiles" && state.failProfileUpdate) {
          return { data: null, error: { message: "boom" } };
        }
        for (const row of hits) Object.assign(row, patch);
      }
      if (one) {
        if (hits.length !== 1) return { data: null, error: { message: "none" } };
        return { data: { ...hits[0] }, error: null };
      }
      return { data: hits.map((row) => ({ ...row })), error: null };
    }

    const builder = {
      select: () => builder,
      update: (next: Record<string, unknown>) => {
        patch = next;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push({ op: "eq", col, val });
        return builder;
      },
      ilike: (col: string, val: unknown) => {
        filters.push({ op: "ilike", col, val });
        return builder;
      },
      single: () => Promise.resolve(execute(true)),
      then: (
        resolve: (value: { data: unknown; error: { message: string } | null }) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(execute(false)).then(resolve, reject),
    };
    return builder;
  }

  const updateUserById = vi.fn(
    async (id: string, attrs: { email?: string; email_confirm?: boolean }) => {
      if (state.authUpdateError) {
        return { data: { user: null }, error: state.authUpdateError };
      }
      state.authEmail = attrs.email ?? state.authEmail;
      return { data: { user: { id, email: state.authEmail } }, error: null };
    },
  );
  const getUserById = vi.fn(async (id: string) => ({
    data: { user: { id, email: state.authEmail } },
    error: null,
  }));
  const listUsers = vi.fn(async () => ({
    data: {
      users: state.authEmail
        ? [{ id: state.profiles[0]?.id ?? "self", email: state.authEmail }]
        : [],
    },
    error: null,
  }));
  const generateLink = vi.fn(async () => ({
    data: {
      properties: { hashed_token: "tok-1", verification_type: "magiclink" },
      user: { id: state.profiles[0]?.id },
    },
    error: null,
  }));

  return {
    getAuthenticatedUser: vi.fn(),
    sendEmail: vi.fn(async (..._args: unknown[]) => ({ ok: true, id: "msg_1" })),
    logEvent: vi.fn(async (..._args: unknown[]) => ({ id: "evt_1" })),
    supabaseAdmin: {
      from,
      auth: { admin: { updateUserById, getUserById, listUsers, generateLink } },
    },
    state,
    writes,
    updateUserById,
    getUserById,
    listUsers,
    generateLink,
  };
});

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (input: unknown) => sendEmail(input),
}));
vi.mock("@/lib/data/events", () => ({
  logEvent: (input: unknown) => logEvent(input),
}));

import { POST } from "./route";

function post(id: string, body: unknown, raw = false): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/managed-brands/${id}/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function seedManagedBrand() {
  state.profiles = [
    { id: BRAND_ID, email: OLD_EMAIL, role: "brand", is_managed: true },
  ];
  state.deals = [{ id: "deal-1", brand_id: BRAND_ID }];
  state.campaigns = [{ id: "camp-1", user_id: BRAND_ID }];
  state.insertion_orders = [{ id: "io-1", deal_id: "deal-1" }];
  state.brand_profiles = [{ id: "bp-1", user_id: BRAND_ID }];
  state.outreaches = [{ id: "out-1", campaign_id: "camp-1" }];
  state.invoices = [{ id: "inv-1", user_id: BRAND_ID }];
  state.payments = [{ id: "pay-1", user_id: BRAND_ID }];
  state.authEmail = OLD_EMAIL;
  state.failProfileUpdate = false;
  state.authUpdateError = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.MANAGED_ACCOUNT_INBOX = "ops-inbox@taylslate.com";
  seedManagedBrand();
  getAuthenticatedUser.mockResolvedValue({
    id: ADMIN_ID,
    email: "ops@taylslate.com",
  });
  sendEmail.mockResolvedValue({ ok: true, id: "msg_1" });
  logEvent.mockResolvedValue({ id: "evt_1" });
});

describe("POST /api/admin/managed-brands/[id]/handoff", () => {
  it("returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValueOnce(null);
    const res = await POST(post(BRAND_ID, { email: NEW_EMAIL }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(res.status).toBe(401);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(state.profiles[0].is_managed).toBe(true);
  });

  it("returns 403 for a signed-in user who is not an internal admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "u1", email: "brand@x.com" });
    const res = await POST(post(BRAND_ID, { email: NEW_EMAIL }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(res.status).toBe(403);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("refuses when the email already belongs to another profile", async () => {
    state.profiles.push({
      id: OTHER_ID,
      email: NEW_EMAIL,
      role: "brand",
      is_managed: false,
    });
    const res = await POST(post(BRAND_ID, { email: NEW_EMAIL }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "That email already belongs to another account",
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.profiles[0]).toMatchObject({
      email: OLD_EMAIL,
      is_managed: true,
    });
    expect(state.authEmail).toBe(OLD_EMAIL);
  });

  it("refuses when the email already belongs to another auth user", async () => {
    listUsers.mockResolvedValueOnce({
      data: {
        users: [
          { id: BRAND_ID, email: OLD_EMAIL },
          { id: OTHER_ID, email: NEW_EMAIL },
        ],
      },
      error: null,
    });
    const res = await POST(post(BRAND_ID, { email: `  ${NEW_EMAIL.toUpperCase()} ` }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "That email already belongs to another account",
    );
    expect(updateUserById).not.toHaveBeenCalled();
    expect(state.deals[0].brand_id).toBe(BRAND_ID);
  });

  it("refuses when the auth update reports the email is taken", async () => {
    state.authUpdateError = {
      message: "A user with this email address has already been registered",
      code: "email_exists",
    };
    const res = await POST(post(BRAND_ID, { email: NEW_EMAIL }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(res.status).toBe(409);
    expect(writes).toEqual([]);
    expect(state.profiles[0].is_managed).toBe(true);
    expect(logEvent).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("flips is_managed, keeps child rows on the same user id, audits, and emails the new address", async () => {
    const res = await POST(post(BRAND_ID, { email: NEW_EMAIL }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: BRAND_ID,
      email: NEW_EMAIL,
      isManaged: false,
      emailSent: true,
    });

    expect(updateUserById).toHaveBeenCalledWith(BRAND_ID, {
      email: NEW_EMAIL,
      email_confirm: true,
    });
    expect(state.authEmail).toBe(NEW_EMAIL);
    expect(state.profiles[0]).toMatchObject({
      id: BRAND_ID,
      email: NEW_EMAIL,
      is_managed: false,
    });
    expect(writes).toEqual(["profiles"]);

    expect(state.deals[0]).toEqual({ id: "deal-1", brand_id: BRAND_ID });
    expect(state.campaigns[0]).toEqual({ id: "camp-1", user_id: BRAND_ID });
    expect(state.insertion_orders[0]).toEqual({ id: "io-1", deal_id: "deal-1" });
    expect(state.brand_profiles[0]).toEqual({ id: "bp-1", user_id: BRAND_ID });
    expect(state.outreaches[0].campaign_id).toBe("camp-1");
    expect(state.invoices[0].user_id).toBe(BRAND_ID);
    expect(state.payments[0].user_id).toBe(BRAND_ID);

    expect(logEvent).toHaveBeenCalledTimes(1);
    const audit = logEvent.mock.calls[0][0] as {
      payload: { timestamp: string };
    };
    expect(audit).toMatchObject({
      eventType: "account.handoff",
      entityType: "profile",
      entityId: BRAND_ID,
      actorId: ADMIN_ID,
      payload: {
        actor_email: "ops@taylslate.com",
        brand_user_id: BRAND_ID,
        old_email: OLD_EMAIL,
        new_email: NEW_EMAIL,
      },
    });
    expect(new Date(audit.payload.timestamp).toISOString()).toBe(audit.payload.timestamp);

    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: NEW_EMAIL,
      options: {
        redirectTo: "http://localhost:3000/callback?next=%2Fdashboard",
        shouldCreateUser: false,
      },
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0] as {
      to: string;
      bypassManagedReroute?: boolean;
      subject: string;
      html: string;
      text: string;
    };
    expect(mail.to).toBe(NEW_EMAIL);
    expect(mail.to).not.toBe("ops-inbox@taylslate.com");
    expect(mail.bypassManagedReroute).toBe(true);
    expect(mail.subject).toBe("Log in to Taylslate");
    expect(mail.html).toContain(
      "http://localhost:3000/callback?token_hash=tok-1&amp;type=magiclink&amp;next=%2Fdashboard",
    );
    expect(mail.text).toContain(
      "http://localhost:3000/callback?token_hash=tok-1&type=magiclink&next=%2Fdashboard",
    );
    expect(mail.subject.startsWith("[managed:")).toBe(false);
  });

  it("returns 409 on a second call and changes nothing", async () => {
    const first = await POST(post(BRAND_ID, { email: NEW_EMAIL }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(first.status).toBe(200);

    updateUserById.mockClear();
    logEvent.mockClear();
    sendEmail.mockClear();
    generateLink.mockClear();
    writes.length = 0;

    const second = await POST(post(BRAND_ID, { email: "someone-else@brand.com" }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: "This account has already been handed off",
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(generateLink).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(state.profiles[0]).toMatchObject({
      id: BRAND_ID,
      email: NEW_EMAIL,
      is_managed: false,
    });
    expect(state.authEmail).toBe(NEW_EMAIL);
    expect(state.deals[0].brand_id).toBe(BRAND_ID);
    expect(state.campaigns[0].user_id).toBe(BRAND_ID);
    expect(state.insertion_orders[0].deal_id).toBe("deal-1");
  });

  it("finishes a profile update when the login email already switched", async () => {
    state.authEmail = NEW_EMAIL;
    const res = await POST(post(BRAND_ID, { email: NEW_EMAIL }), {
      params: Promise.resolve({ id: BRAND_ID }),
    });
    expect(res.status).toBe(200);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(state.profiles[0]).toMatchObject({
      email: NEW_EMAIL,
      is_managed: false,
    });
    const resumeAudit = logEvent.mock.calls[0][0] as {
      payload: { old_email: string };
    };
    const resumeMail = sendEmail.mock.calls[0][0] as { to: string };
    expect(resumeAudit.payload.old_email).toBe(OLD_EMAIL);
    expect(resumeMail.to).toBe(NEW_EMAIL);
  });
});
