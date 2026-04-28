import { describe, it, expect, vi, beforeEach } from "vitest";

// Builder shape: payments query chain (from -> select -> eq -> eq -> gte -> lte)
// then awaited; profiles chain for getAllPaygCustomersAboveBreakeven.

const { paymentsResult, profilesResult, supabaseAdmin } = vi.hoisted(() => {
  const paymentsResult = {
    data: [] as unknown[] | null,
    error: null as unknown,
  };
  const profilesResult = {
    data: [] as unknown[] | null,
    error: null as unknown,
  };

  const paymentsBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn(() => Promise.resolve(paymentsResult)),
  };
  const profilesBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(() => Promise.resolve(profilesResult)),
  };
  return {
    paymentsResult,
    profilesResult,
    supabaseAdmin: {
      from: vi.fn((table: string) =>
        table === "payments" ? paymentsBuilder : profilesBuilder
      ),
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import {
  getTrailingGmv,
  getAllPaygCustomersAboveBreakeven,
} from "./gmv";

beforeEach(() => {
  paymentsResult.data = [];
  paymentsResult.error = null;
  profilesResult.data = [];
  profilesResult.error = null;
  vi.clearAllMocks();
});

describe("getTrailingGmv", () => {
  it("returns zeroes when no payments exist for the customer", async () => {
    paymentsResult.data = [];
    const gmv = await getTrailingGmv("u1");
    expect(gmv.totalCents).toBe(0);
    expect(gmv.dailyAvgCents).toBe(0);
    expect(gmv.monthlyAvgCents).toBe(0);
    // periodStart < periodEnd
    expect(new Date(gmv.periodStart).getTime()).toBeLessThan(
      new Date(gmv.periodEnd).getTime()
    );
  });

  it("sums amount_charged_cents across rows", async () => {
    paymentsResult.data = [
      { amount_charged_cents: 100_000 },
      { amount_charged_cents: 200_000 },
      { amount_charged_cents: 50_000 },
    ];
    const gmv = await getTrailingGmv("u1");
    expect(gmv.totalCents).toBe(350_000);
  });

  it("computes dailyAvgCents and monthlyAvgCents against the configured window", async () => {
    // total = $9,000 across the 90-day window → daily $100, monthly $3,000.
    paymentsResult.data = [{ amount_charged_cents: 900_000 }];
    const gmv = await getTrailingGmv("u1", 90);
    expect(gmv.totalCents).toBe(900_000);
    expect(gmv.dailyAvgCents).toBe(10_000); // 900_000 / 90
    expect(gmv.monthlyAvgCents).toBe(300_000); // dailyAvg * 30
  });

  it("uses the configured window even when actual data is sparse (partial period)", async () => {
    // Only one row totalling $1,500 — averaging still divides by full 90.
    paymentsResult.data = [{ amount_charged_cents: 150_000 }];
    const gmv = await getTrailingGmv("u1", 90);
    expect(gmv.monthlyAvgCents).toBe(50_000); // (150_000 / 90) * 30
  });

  it("treats null amount_charged_cents as 0", async () => {
    paymentsResult.data = [
      { amount_charged_cents: null },
      { amount_charged_cents: 25_000 },
    ];
    const gmv = await getTrailingGmv("u1");
    expect(gmv.totalCents).toBe(25_000);
  });

  it("returns zeroes (does not throw) on Supabase error", async () => {
    paymentsResult.data = null;
    paymentsResult.error = { message: "boom", code: "X" };
    const gmv = await getTrailingGmv("u1");
    expect(gmv.totalCents).toBe(0);
  });
});

describe("getAllPaygCustomersAboveBreakeven", () => {
  it("returns only customers whose monthlyAvgCents exceeds the threshold", async () => {
    profilesResult.data = [{ id: "u-low" }, { id: "u-high" }];
    // Each call hits payments. Low: total = $300 → monthlyAvg ≈ $100;
    // high: total = $60,000 → monthlyAvg ≈ $20,000.
    const lowRow = [{ amount_charged_cents: 30_000 }];
    const highRow = [{ amount_charged_cents: 6_000_000 }];

    const datas = [lowRow, highRow];
    paymentsResult.data = datas[0];
    let call = 0;
    // We need the lte mock to return different data per invocation.
    const builder = supabaseAdmin.from("payments") as unknown as {
      lte: ReturnType<typeof vi.fn>;
    };
    builder.lte.mockImplementation(() =>
      Promise.resolve({ data: datas[call++ % datas.length], error: null })
    );

    const above = await getAllPaygCustomersAboveBreakeven(1_250_000);
    expect(above).toHaveLength(1);
    expect(above[0].customerId).toBe("u-high");
    expect(above[0].monthlyAvgCents).toBeGreaterThan(1_250_000);
  });

  it("returns empty array when the profile lookup errors", async () => {
    profilesResult.data = null;
    profilesResult.error = { message: "boom" };
    const above = await getAllPaygCustomersAboveBreakeven();
    expect(above).toEqual([]);
  });
});
