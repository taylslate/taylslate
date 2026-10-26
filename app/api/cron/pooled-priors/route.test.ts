import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshPooledImportPriors = vi.fn();
const refreshPooledDealPriors = vi.fn();

vi.mock("@/lib/learning/pooled-priors", () => ({
  refreshPooledImportPriors: (...args: unknown[]) => refreshPooledImportPriors(...args),
}));
vi.mock("@/lib/learning/pooled-deal-priors", () => ({
  refreshPooledDealPriors: (...args: unknown[]) => refreshPooledDealPriors(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/pooled-priors", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("GET /api/cron/pooled-priors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    refreshPooledImportPriors.mockResolvedValue(2);
    refreshPooledDealPriors.mockResolvedValue(1);
  });

  it("rejects a request without CRON_SECRET", async () => {
    const missingEnv = await GET(request("Bearer anything") as never);
    expect(missingEnv.status).toBe(401);
    expect(refreshPooledImportPriors).not.toHaveBeenCalled();
    expect(refreshPooledDealPriors).not.toHaveBeenCalled();

    process.env.CRON_SECRET = "cron-secret";
    const missingHeader = await GET(request() as never);
    expect(missingHeader.status).toBe(401);
    const wrong = await GET(request("Bearer other") as never);
    expect(wrong.status).toBe(401);
    expect(refreshPooledDealPriors).not.toHaveBeenCalled();
  });

  it("refreshes both pools with the service-role helpers", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ import_priors: 2, deal_priors: 1 });
    expect(refreshPooledImportPriors).toHaveBeenCalledOnce();
    expect(refreshPooledDealPriors).toHaveBeenCalledOnce();

    const src = readFileSync(join(process.cwd(), "app/api/cron/pooled-priors/route.ts"), "utf8");
    expect(src).not.toMatch(/lib\/(stripe|payouts|billing|airchecks|imports|reps|api\/v1)/);
    expect(src).not.toContain("\u2014");

    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.regions).toEqual(["pdx1"]);
    expect(vercel.crons).toEqual([
      { path: "/api/cron/deal-timeouts", schedule: "0 14 * * *" },
      { path: "/api/cron/conversion-alerts", schedule: "0 15 * * *" },
      { path: "/api/cron/pooled-priors", schedule: "0 16 * * *" },
    ]);
  });
});
