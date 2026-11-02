import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runYoutubeEmailBackfill = vi.fn();

vi.mock("@/lib/youtube-library/emails-backfill", () => ({
  runYoutubeEmailBackfill: (...args: unknown[]) => runYoutubeEmailBackfill(...args),
}));

import { GET } from "./route";

function request(authorization?: string): Request {
  return new Request("http://localhost/api/cron/youtube-library-emails", {
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("GET /api/cron/youtube-library-emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    runYoutubeEmailBackfill.mockResolvedValue({ skipped: true, reason: "missing_yt2", units: 0 });
  });

  it("rejects a request without the bearer secret", async () => {
    const missingEnv = await GET(request("Bearer anything") as never);
    expect(missingEnv.status).toBe(401);
    expect(runYoutubeEmailBackfill).not.toHaveBeenCalled();

    process.env.CRON_SECRET = "cron-secret";
    const missingHeader = await GET(request() as never);
    expect(missingHeader.status).toBe(401);
    const wrong = await GET(request("Bearer other") as never);
    expect(wrong.status).toBe(401);
    expect(runYoutubeEmailBackfill).not.toHaveBeenCalled();
  });

  it("runs the backfill when the bearer matches and does not log a key", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const res = await GET(request("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ skipped: true, reason: "missing_yt2" });
    expect(runYoutubeEmailBackfill).toHaveBeenCalledOnce();

    const src = readFileSync(join(process.cwd(), "app/api/cron/youtube-library-emails/route.ts"), "utf8");
    expect(src).toContain("Bearer ${secret}");
    expect(src).not.toContain("YOUTUBE_API_KEY");
    expect(src).not.toContain("\u2014");
    expect(src).toContain("export const maxDuration = 300");
    expect(src).toContain("Do not raise it");

    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.regions).toEqual(["pdx1"]);
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/youtube-library-emails",
      schedule: "0 19 * * *",
    });
  });
});
