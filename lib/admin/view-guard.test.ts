import { beforeEach, describe, expect, it, vi } from "vitest";

const BLOCKED = "Money actions are blocked while viewing as a test account";

const {
  getAuthenticatedUser,
  getBrandProfileByUserId,
  getWave12DealById,
  chargeForEpisode,
  createSetupIntentForBrand,
  transferEarlyPayoutForPayment,
  stripe,
  rows,
  supabaseAdmin,
} = vi.hoisted(() => {
  const rows: Record<string, unknown> = {};
  function chain(data: unknown) {
    const api = {
      select: () => api,
      eq: () => api,
      update: () => api,
      single: () =>
        Promise.resolve({
          data,
          error: data ? null : { message: "missing" },
        }),
    };
    return api;
  }
  return {
    getAuthenticatedUser: vi.fn(),
    getBrandProfileByUserId: vi.fn(),
    getWave12DealById: vi.fn(),
    chargeForEpisode: vi.fn(),
    createSetupIntentForBrand: vi.fn(),
    transferEarlyPayoutForPayment: vi.fn(),
    stripe: {
      customers: { create: vi.fn(), retrieve: vi.fn() },
      paymentMethods: { retrieve: vi.fn(), detach: vi.fn() },
      setupIntents: { create: vi.fn(), retrieve: vi.fn() },
    },
    rows,
    supabaseAdmin: {
      from: vi.fn((table: string) => chain(rows[table] ?? null)),
    },
  };
});

vi.mock("@/lib/data/queries", () => ({
  VIEW_AS_COOKIE: "taylslate_view_as",
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getBrandProfileByUserId: (...args: unknown[]) => getBrandProfileByUserId(...args),
  getWave12DealById: (...args: unknown[]) => getWave12DealById(...args),
}));

vi.mock("@/lib/stripe/server", () => ({ stripe }));
vi.mock("@/lib/stripe/payment-intent", () => ({
  chargeForEpisode: (...args: unknown[]) => chargeForEpisode(...args),
}));
vi.mock("@/lib/stripe/setup-intent", () => ({
  createSetupIntentForBrand: (...args: unknown[]) => createSetupIntentForBrand(...args),
}));
vi.mock("@/lib/payouts/transfer", () => ({
  transferEarlyPayoutForPayment: (...args: unknown[]) =>
    transferEarlyPayoutForPayment(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/data/events", () => ({ logEvent: vi.fn() }));

import { rejectSwitchedViewMoneyAction } from "./view-guard";
import { POST as chargeEpisode } from "@/app/api/deals/[id]/charge-episode/route";
import { POST as dealSetupIntent } from "@/app/api/deals/[id]/setup-intent/route";
import { POST as earlyPayout } from "@/app/api/payouts/early/route";
import { POST as cardSetupIntent } from "@/app/api/stripe/payment-method/setup-intent/route";
import { DELETE as detachCard } from "@/app/api/stripe/payment-method/[id]/route";
import { POST as createCustomer } from "@/app/api/stripe/customer/create/route";

const ADMIN = { id: "admin-1", email: "ops@taylslate.com" };
const BRAND = { id: "brand-1", email: "brand@example.com" };
const SHOW = { id: "show-1", email: "show@example.com" };

function request(url: string, init?: { method?: string; cookie?: string; body?: unknown }) {
  const headers = new Headers();
  if (init?.cookie) headers.set("cookie", init.cookie);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, {
    method: init?.method ?? "POST",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const switched = "taylslate_view_as=test:show1";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_ADMIN_EMAILS = "ops@taylslate.com";
  for (const key of Object.keys(rows)) delete rows[key];
  getAuthenticatedUser.mockResolvedValue(BRAND);
  chargeForEpisode.mockResolvedValue({ ok: true });
  transferEarlyPayoutForPayment.mockResolvedValue({ ok: true });
  stripe.customers.retrieve.mockResolvedValue({ id: "cus_1" });
  stripe.customers.create.mockResolvedValue({ id: "cus_new" });
  stripe.setupIntents.create.mockResolvedValue({ client_secret: "seti_secret" });
  stripe.paymentMethods.retrieve.mockResolvedValue({ customer: "cus_1" });
  stripe.paymentMethods.detach.mockResolvedValue({});
});

describe("rejectSwitchedViewMoneyAction", () => {
  it("ignores a request with no view cookie", async () => {
    const res = await rejectSwitchedViewMoneyAction(request("http://x"));
    expect(res).toBeNull();
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("ignores the existing brand/show view cookie", async () => {
    const res = await rejectSwitchedViewMoneyAction(
      request("http://x", { cookie: "taylslate_view_as=show" }),
    );
    expect(res).toBeNull();
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("ignores a forged test cookie without an admin session", async () => {
    getAuthenticatedUser.mockResolvedValue(BRAND);
    const res = await rejectSwitchedViewMoneyAction(
      request("http://x", { cookie: switched }),
    );
    expect(res).toBeNull();
  });

  it("blocks an admin session that is viewing as a test account", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const res = await rejectSwitchedViewMoneyAction(
      request("http://x", { cookie: switched }),
    );
    expect(res?.status).toBe(403);
    expect(await res!.json()).toEqual({ error: BLOCKED });
  });

  it("blocks an admin viewing as the test agent", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const res = await rejectSwitchedViewMoneyAction(
      request("http://x", { cookie: "taylslate_view_as=test:agent1" }),
    );
    expect(res?.status).toBe(403);
    expect(await res!.json()).toEqual({ error: BLOCKED });
  });
});

describe("money routes in and out of an admin view", () => {
  const params = Promise.resolve({ id: "d1" });

  it("blocks charge-episode in a switched view and runs it outside", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const blocked = await chargeEpisode(
      request("http://x/api/deals/d1/charge-episode", {
        cookie: switched,
        body: { ioLineItemId: "li_1" },
      }) as never,
      { params },
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: BLOCKED });
    expect(chargeForEpisode).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue(BRAND);
    getWave12DealById.mockResolvedValue({ id: "d1", brand_profile_id: "bp" });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp" });
    const open = await chargeEpisode(
      request("http://x/api/deals/d1/charge-episode", {
        body: { ioLineItemId: "li_1" },
      }) as never,
      { params },
    );
    expect(open.status).toBe(200);
    expect(chargeForEpisode).toHaveBeenCalledOnce();

    chargeForEpisode.mockClear();
    const forged = await chargeEpisode(
      request("http://x/api/deals/d1/charge-episode", {
        cookie: switched,
        body: { ioLineItemId: "li_1" },
      }) as never,
      { params },
    );
    expect(forged.status).toBe(200);
    expect(chargeForEpisode).toHaveBeenCalledOnce();
  });

  it("blocks deal setup-intent in a switched view and runs it outside", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const blocked = await dealSetupIntent(
      request("http://x/api/deals/d1/setup-intent", { cookie: switched }) as never,
      { params },
    );
    expect(blocked.status).toBe(403);
    expect(getWave12DealById).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue(BRAND);
    getWave12DealById.mockResolvedValue({
      id: "d1",
      brand_profile_id: "bp",
      brand_signed_at: "2026-01-01T00:00:00.000Z",
      payment_method_id: "pm_1",
    });
    getBrandProfileByUserId.mockResolvedValue({ id: "bp" });
    const open = await dealSetupIntent(
      request("http://x/api/deals/d1/setup-intent") as never,
      { params },
    );
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({
      status: "already_saved",
      payment_method_id: "pm_1",
    });
  });

  it("blocks early payout in a switched view and runs it outside", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const blocked = await earlyPayout(
      request("http://x/api/payouts/early", {
        cookie: switched,
        body: { paymentId: "pay1" },
      }) as never,
    );
    expect(blocked.status).toBe(403);
    expect(transferEarlyPayoutForPayment).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue(SHOW);
    rows.payments = { id: "pay1", deal_id: "d1" };
    rows.deals = { id: "d1", show_profile_id: "sp1" };
    rows.show_profiles = { id: "sp1", user_id: SHOW.id };
    const open = await earlyPayout(
      request("http://x/api/payouts/early", { body: { paymentId: "pay1" } }) as never,
    );
    expect(open.status).toBe(200);
    expect(transferEarlyPayoutForPayment).toHaveBeenCalledOnce();
  });

  it("blocks card setup-intent in a switched view and runs it outside", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const blocked = await cardSetupIntent(
      request("http://x/api/stripe/payment-method/setup-intent", {
        cookie: switched,
      }) as never,
    );
    expect(blocked.status).toBe(403);
    expect(stripe.setupIntents.create).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue(BRAND);
    rows.profiles = {
      id: BRAND.id,
      email: BRAND.email,
      full_name: "Brand",
      stripe_customer_id: "cus_1",
    };
    const open = await cardSetupIntent(
      request("http://x/api/stripe/payment-method/setup-intent") as never,
    );
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ clientSecret: "seti_secret" });
    expect(stripe.setupIntents.create).toHaveBeenCalledOnce();
  });

  it("blocks card detach in a switched view and runs it outside", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const blocked = await detachCard(
      request("http://x/api/stripe/payment-method/pm_1", {
        method: "DELETE",
        cookie: switched,
      }) as never,
      { params: Promise.resolve({ id: "pm_1" }) },
    );
    expect(blocked.status).toBe(403);
    expect(stripe.paymentMethods.detach).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue(BRAND);
    rows.profiles = { id: BRAND.id, stripe_customer_id: "cus_1" };
    const open = await detachCard(
      request("http://x/api/stripe/payment-method/pm_1", { method: "DELETE" }) as never,
      { params: Promise.resolve({ id: "pm_1" }) },
    );
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ success: true });
    expect(stripe.paymentMethods.detach).toHaveBeenCalledWith("pm_1");
  });

  it("blocks customer create in a switched view and runs it outside", async () => {
    getAuthenticatedUser.mockResolvedValue(ADMIN);
    const blocked = await createCustomer(
      request("http://x/api/stripe/customer/create", { cookie: switched }) as never,
    );
    expect(blocked.status).toBe(403);
    expect(stripe.customers.create).not.toHaveBeenCalled();

    getAuthenticatedUser.mockResolvedValue(BRAND);
    rows.profiles = {
      id: BRAND.id,
      email: BRAND.email,
      full_name: "Brand",
      role: "brand",
      company_name: "",
      stripe_customer_id: null,
    };
    const open = await createCustomer(
      request("http://x/api/stripe/customer/create") as never,
    );
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ customerId: "cus_new" });
    expect(stripe.customers.create).toHaveBeenCalledOnce();
  });
});
