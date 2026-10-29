import { beforeEach, describe, expect, it, vi } from "vitest";

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

const { supabaseAdmin, query } = vi.hoisted(() => {
  const query = {
    select: [] as unknown[][],
    eq: [] as unknown[][],
    gte: [] as unknown[][],
    lt: [] as unknown[][],
  };
  let result: CountResult = { count: 0, error: null };
  const builder = {
    select: vi.fn((...args: unknown[]) => {
      query.select.push(args);
      return builder;
    }),
    eq: vi.fn((...args: unknown[]) => {
      query.eq.push(args);
      return builder;
    }),
    gte: vi.fn((...args: unknown[]) => {
      query.gte.push(args);
      return builder;
    }),
    lt: vi.fn((...args: unknown[]) => {
      query.lt.push(args);
      return builder;
    }),
    then(
      resolve: (value: CountResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return {
    query,
    supabaseAdmin: {
      from: vi.fn(() => builder),
      _setResult(next: CountResult) {
        result = next;
      },
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin }));

import { denverMonthBounds, getDocuSignUsage } from "./usage";

function resetQuery() {
  query.select.length = 0;
  query.eq.length = 0;
  query.gte.length = 0;
  query.lt.length = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetQuery();
  delete process.env.DOCUSIGN_ENV;
  supabaseAdmin._setResult({ count: 0, error: null });
});

describe("denverMonthBounds", () => {
  it("keeps 2026-11-01 05:59:59 UTC in October and starts November at 06:00 UTC", () => {
    const october = denverMonthBounds(new Date("2026-10-15T18:00:00.000Z"));
    const stillOctober = Date.parse("2026-11-01T05:59:59.000Z");
    const novemberStart = Date.parse("2026-11-01T06:00:00.000Z");

    expect(october.label).toBe("October 2026");
    expect(october.startIso).toBe("2026-10-01T06:00:00.000Z");
    expect(october.nextStartIso).toBe("2026-11-01T06:00:00.000Z");
    expect(stillOctober).toBeGreaterThanOrEqual(Date.parse(october.startIso));
    expect(stillOctober).toBeLessThan(Date.parse(october.nextStartIso));
    expect(novemberStart).toBe(Date.parse(october.nextStartIso));

    const atTheInstant = denverMonthBounds(new Date("2026-11-01T05:59:59.000Z"));
    expect(atTheInstant.label).toBe("October 2026");
    expect(atTheInstant.nextStartIso).toBe("2026-11-01T06:00:00.000Z");
  });

  it("treats 2026-11-01 06:00:00 UTC as November 1 00:00 MDT, outside October", () => {
    const november = denverMonthBounds(new Date("2026-11-01T06:00:00.000Z"));
    expect(november.label).toBe("November 2026");
    expect(november.startIso).toBe("2026-11-01T06:00:00.000Z");
    expect(Date.parse("2026-11-01T05:59:59.000Z")).toBeLessThan(
      Date.parse(november.startIso),
    );
  });

  it("bounds November 2026 across the MST fallback", () => {
    const november = denverMonthBounds(new Date("2026-11-15T18:00:00.000Z"));
    expect(november.startIso).toBe("2026-11-01T06:00:00.000Z");
    expect(november.nextStartIso).toBe("2026-12-01T07:00:00.000Z");
    expect(november.label).toBe("November 2026");
  });

  it("bounds March 2027 across the MDT start", () => {
    const march = denverMonthBounds(new Date("2027-03-15T18:00:00.000Z"));
    expect(march.startIso).toBe("2027-03-01T07:00:00.000Z");
    expect(march.nextStartIso).toBe("2027-04-01T06:00:00.000Z");
    expect(march.label).toBe("March 2027");
  });
});

describe("getDocuSignUsage", () => {
  it("runs one head count on domain_events for the Denver month", async () => {
    process.env.DOCUSIGN_ENV = "production";
    supabaseAdmin._setResult({ count: 12, error: null });
    const now = new Date("2026-11-01T05:59:59.000Z");

    const usage = await getDocuSignUsage(now);

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("domain_events");
    expect(query.select).toEqual([["*", { count: "exact", head: true }]]);
    expect(query.eq).toEqual([["event_type", "io.sent_for_signature"]]);
    expect(query.gte).toEqual([["created_at", "2026-10-01T06:00:00.000Z"]]);
    expect(query.lt).toEqual([["created_at", "2026-11-01T06:00:00.000Z"]]);
    expect(usage).toEqual({
      used: 12,
      limit: 40,
      warnAt: 35,
      remaining: 28,
      state: "ok",
      month: "October 2026",
      environment: "production",
    });
  });

  it("uses November bounds once Denver has rolled to November 1", async () => {
    process.env.DOCUSIGN_ENV = "production";
    supabaseAdmin._setResult({ count: 0, error: null });

    const usage = await getDocuSignUsage(new Date("2026-11-01T06:00:00.000Z"));

    expect(query.gte).toEqual([["created_at", "2026-11-01T06:00:00.000Z"]]);
    expect(query.lt).toEqual([["created_at", "2026-12-01T07:00:00.000Z"]]);
    expect(usage.used).toBe(0);
    expect(usage.month).toBe("November 2026");
    expect(usage.state).toBe("ok");
  });

  it.each([
    [34, "ok", 6],
    [35, "warn", 5],
    [40, "warn", 0],
    [41, "over", 0],
  ] as const)("production count %s is %s", async (used, state, remaining) => {
    process.env.DOCUSIGN_ENV = "production";
    supabaseAdmin._setResult({ count: used, error: null });

    const usage = await getDocuSignUsage(new Date("2026-10-15T18:00:00.000Z"));

    expect(usage.state).toBe(state);
    expect(usage.remaining).toBe(remaining);
    expect(usage.used).toBe(used);
    expect(usage.environment).toBe("production");
  });

  it("stays ok in sandbox, including above the allowance", async () => {
    supabaseAdmin._setResult({ count: 41, error: null });

    const unset = await getDocuSignUsage(new Date("2026-10-15T18:00:00.000Z"));
    expect(unset.environment).toBe("sandbox");
    expect(unset.state).toBe("ok");
    expect(unset.used).toBe(41);

    resetQuery();
    process.env.DOCUSIGN_ENV = "sandbox";
    const explicit = await getDocuSignUsage(new Date("2026-10-15T18:00:00.000Z"));
    expect(explicit.environment).toBe("sandbox");
    expect(explicit.state).toBe("ok");
  });

  it("throws on a read error and does not resolve as zero", async () => {
    supabaseAdmin._setResult({ count: null, error: { message: "db down" } });

    await expect(
      getDocuSignUsage(new Date("2026-10-15T18:00:00.000Z")),
    ).rejects.toThrow(/db down/);
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it("throws when the count is missing", async () => {
    supabaseAdmin._setResult({ count: null, error: null });

    await expect(getDocuSignUsage()).rejects.toThrow(/count failed/);
  });
});
