import { beforeEach, describe, expect, it, vi } from "vitest";

const sweepHeldPayouts = vi.fn();

vi.mock("@/lib/payouts/release", () => ({
  sweepHeldPayouts: (...args: unknown[]) => sweepHeldPayouts(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/payout-releases", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/payout-releases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    sweepHeldPayouts.mockResolvedValue({
      released: 1,
      held: 2,
      failed: 0,
      secret: "secret-db-text",
    });
  });

  it("returns 401 without the bearer and only counts with it", async () => {
    const missingEnv = await GET(request("Bearer cron-secret") as never);
    expect(missingEnv.status).toBe(401);
    expect(missingEnv.headers.get("cache-control")).toBe("no-store");
    expect(await missingEnv.json()).toEqual({ error: "Unauthorized" });
    expect(sweepHeldPayouts).not.toHaveBeenCalled();

    process.env.CRON_SECRET = "cron-secret";
    const missing = await GET(request() as never);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const wrong = await GET(request("Bearer cron-secreX") as never);
    expect(wrong.status).toBe(401);
    expect(sweepHeldPayouts).not.toHaveBeenCalled();

    const ok = await GET(request("Bearer cron-secret") as never);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await ok.json();
    expect(body).toEqual({ released: 1, held: 2, failed: 0 });
    expect(JSON.stringify(body)).not.toContain("secret-db-text");
    expect(sweepHeldPayouts).toHaveBeenCalledTimes(1);
  });
});