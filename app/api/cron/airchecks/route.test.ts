import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runAutomatedAirchecks = vi.fn();

vi.mock("@/lib/airchecks/run", () => ({
  runAutomatedAirchecks: (...args: unknown[]) => runAutomatedAirchecks(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/airchecks", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("GET /api/cron/airchecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    runAutomatedAirchecks.mockResolvedValue({ skipped: "missing_openai_api_key" });
  });

  it("rejects a request without CRON_SECRET", async () => {
    const missingEnv = await GET(request("Bearer anything") as never);
    expect(missingEnv.status).toBe(401);
    process.env.CRON_SECRET = "cron-secret";
    const missingHeader = await GET(request() as never);
    expect(missingHeader.status).toBe(401);
    const wrong = await GET(request("Bearer other") as never);
    expect(wrong.status).toBe(401);
    expect(runAutomatedAirchecks).not.toHaveBeenCalled();
  });

  it("runs the aircheck job and is on the cron list", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ skipped: "missing_openai_api_key" });
    expect(runAutomatedAirchecks).toHaveBeenCalledOnce();

    const src = readFileSync(join(process.cwd(), "app/api/cron/airchecks/route.ts"), "utf8");
    expect(src).not.toMatch(/lib\/(stripe|payouts|billing)/);
    expect(src).not.toContain("\u2014");

    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.regions).toEqual(["pdx1"]);
    expect(vercel.crons).toContainEqual({ path: "/api/cron/airchecks", schedule: "0 20 * * *" });
  });
});
