import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sweepOwnerVerificationNotices = vi.fn();

vi.mock("@/lib/reps/roster-notify", () => ({
  sweepOwnerVerificationNotices: (...args: unknown[]) => sweepOwnerVerificationNotices(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/roster-owner-notices", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("GET /api/cron/roster-owner-notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    sweepOwnerVerificationNotices.mockResolvedValue({ sent: 0, already: 0, skipped: 0 });
  });

  it("rejects a request without the bearer secret", async () => {
    const missingEnv = await GET(request("Bearer anything") as never);
    expect(missingEnv.status).toBe(401);
    expect(sweepOwnerVerificationNotices).not.toHaveBeenCalled();

    process.env.CRON_SECRET = "cron-secret";
    const missingHeader = await GET(request() as never);
    expect(missingHeader.status).toBe(401);
    const wrong = await GET(request("Bearer other") as never);
    expect(wrong.status).toBe(401);
    const sameLength = await GET(request("Bearer cron-secreX") as never);
    expect(sameLength.status).toBe(401);
    expect(sweepOwnerVerificationNotices).not.toHaveBeenCalled();
  });

  it("runs the sweep when the bearer matches and adds one daily cron", async () => {
    process.env.CRON_SECRET = "cron-secret";
    sweepOwnerVerificationNotices.mockResolvedValue({ sent: 1, already: 0, skipped: 0 });
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 1, already: 0, skipped: 0 });
    expect(sweepOwnerVerificationNotices).toHaveBeenCalledOnce();

    const src = readFileSync(join(process.cwd(), "app/api/cron/roster-owner-notices/route.ts"), "utf8");
    expect(src).toContain("Bearer ${secret}");
    expect(src).not.toContain("\u2014");

    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.regions).toEqual(["pdx1"]);
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/roster-owner-notices",
      schedule: "0 21 * * *",
    });
    expect(vercel.crons.filter((cron: { path: string }) => cron.path === "/api/cron/roster-owner-notices")).toHaveLength(1);
  });
});
